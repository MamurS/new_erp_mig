# Развёртывание MIG ДМС (staging и production)

Инструкция для администратора МИГ (BACKEND_SPEC §11). Всё работает на одном сервере в Узбекистане: Docker Compose
поднимает self-hosted Supabase (Postgres, Auth, Storage), API и Caddy. **Наружу открыт только Caddy** (порты 443 и
80 для перенаправления на HTTPS). Postgres, Kong, Supabase Auth, Storage, PostgREST и Studio живут во внутренней
сети Docker без выхода в интернет и без опубликованных портов.

Демо-сайт на Cloudflare (моки, `VITE_USE_MOCKS=true`) не меняется — он описан в корневом `README.md`.

## Что лежит в `deploy/`

| Файл                        | Что это                                                                                                                                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docker-compose.yml`        | весь стек: `db`, `auth`, `rest`, `storage`, `kong`, `migrate` (разовый), `api`, `worker`, `caddy`; профиль `studio` — `meta`, `studio`; профиль `imgproxy`; профиль `tools` — `backup`, `offsite` |
| `docker-compose.studio.yml` | Studio только на `127.0.0.1` сервера (SSH-туннель или VPN)                                                                                                                                        |
| `Dockerfile`                | образы `api` (Node 20, без root, только сборка API и `fastify`/`pg`) и `caddy` (Caddy + собранный фронтенд с `VITE_USE_MOCKS=false VITE_DEMO_MODE=false`)                                         |
| `Caddyfile`                 | TLS, раздача фронтенда (SPA), `/api` → API, заголовки безопасности и CSP из `apps/web/public/_headers`, лимиты тела запроса                                                                       |
| `.env.example`              | все переменные без значений → `deploy/.env` (не коммитится)                                                                                                                                       |
| `supabase/`                 | `kong.yml` (внутренний шлюз Supabase), `db/roles.sql`, `db/jwt.sql` (первый запуск БД)                                                                                                            |
| `scripts/deploy.sh`         | выкладка: сборка образов коммита → (резервная копия) → миграции → запуск → проверки; `--rollback`                                                                                                 |
| `scripts/migrate.sh`        | миграции `supabase/migrations/*.sql` по порядку, таблица `supabase_migrations.schema_migrations`                                                                                                  |
| `scripts/gen-secrets.sh`    | генерация всех секретов (`openssl`)                                                                                                                                                               |
| `scripts/create-admin.mjs`  | первый администратор production; сброс пароля или второго фактора                                                                                                                                 |
| `scripts/smoke-check.mjs`   | проверка развёрнутого сайта через Caddy (заголовки, 401/403/413, нет демо-маршрутов, Supabase закрыт, вход с TOTP)                                                                                |
| `scripts/smoke-test.sh`     | весь стек на одной машине в режиме production + проверки + резервная копия и её восстановление (локально и в CI)                                                                                  |
| `backup/`                   | `run-backup.sh` (ежедневно), `backup.sh`, `restore.sh` (чистый сервер), `restore-db.sh`, `verify.sh`, `restore-check.sh` (ежемесячная проверка), `test-local.sh`                                  |

Версии образов закреплены (как у Supabase CLI 2.120.0, на которой идут CI и тесты): `supabase/postgres:15.19.0.004`
(с `pg_cron`), `gotrue:v2.197.0`, `postgrest:v16.4`, `storage-api:v1.79.36`, `kong:2.8.1`, `postgres-meta:v0.100.0`,
`studio:2026.10.05-sha-94b8b06`, `darthsim/imgproxy:v3.26.0`, `node:20.20.2-alpine3.23`, `caddy:2.11.7-alpine`,
`postgres:15.19-alpine3.24` (миграции, резервные копии), `rclone/rclone:1.71.2`. Образы Supabase берутся из
`public.ecr.aws/supabase/…` (те же, что `supabase/…` на Docker Hub, без лимитов Docker Hub). Обновление версий —
отдельным PR после прогона CI.

## 1. Сервер

Рекомендуемая конфигурация и её обоснование — `docs/backend/LOAD.md`. Кратко:

|      | staging                                                                                                                                   | production                                                                     |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| CPU  | 4 vCPU                                                                                                                                    | 8 vCPU                                                                         |
| RAM  | 8 ГБ                                                                                                                                      | 16 ГБ                                                                          |
| Диск | 80 ГБ SSD                                                                                                                                 | 200 ГБ NVMe SSD (БД + файлы Storage + 30 дневных и 12 месячных копий локально) |
| ОС   | Ubuntu 24.04 LTS (или Debian 12)                                                                                                          | то же                                                                          |
| ПО   | Docker Engine 27+ с плагином Compose v2, `git`, `openssl`, `rsync` (если копии по rsync), Node 20 (только для `smoke-check.mjs` и runner) | то же                                                                          |

Отдельное хранилище для копий: S3-совместимый бакет (MinIO МИГ, облако в Узбекистане) или второй сервер по SSH.

## 2. DNS и сеть

1. A-запись (и AAAA, если есть IPv6) домена → IP сервера: например, `dms.mig.uz` (production) и
   `staging.dms.mig.uz` (staging, отдельный сервер или хотя бы отдельный домен).
2. Межсетевой экран — открыты только 80/tcp, 443/tcp, 443/udp (HTTP/3) и SSH для адресов администраторов:

   ```
   ufw default deny incoming
   ufw allow from <IP администраторов> to any port 22 proto tcp
   ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 443/udp
   ufw enable
   ```

   Docker публикует порты в обход ufw, поэтому важно, что в `docker-compose.yml` порты публикует **только Caddy**
   (это проверяет `scripts/smoke-test.sh`). Studio (по желанию) — только на `127.0.0.1` (раздел 9).

3. Исходящий доступ сервера: Docker-реестры (сборка и обновления), SMTP МИГ, хранилище копий, ACME
   (Let's Encrypt/ZeroSSL) при автоматических сертификатах, `github.com` для self-hosted runner.

## 3. Первый запуск

```
sudo mkdir -p /opt/mig-dms && sudo chown $USER /opt/mig-dms
git clone https://github.com/<org>/<repo>.git /opt/mig-dms/app && cd /opt/mig-dms/app
cp deploy/.env.example /opt/mig-dms/production.env      # staging: /opt/mig-dms/staging.env
sh deploy/scripts/gen-secrets.sh --fill /opt/mig-dms/production.env
nano /opt/mig-dms/production.env                         # APP_ENV, DOMAIN, CADDY_TLS, SMTP_*, BACKUP_*
ENV_FILE=/opt/mig-dms/production.env deploy/scripts/deploy.sh
```

Файл окружения лежит **вне** рабочей копии (runner и Coolify чистят каталог сборки), права `600`, владелец — root или
пользователь runner. `deploy.sh` собирает образы `mig-dms/api:<коммит>` и `mig-dms/caddy:<коммит>`, поднимает
Supabase, применяет миграции, запускает `api`, `worker`, `caddy` и проверяет API (401 без сессии; в production
демо-маршрутов нет). Потом — проверка снаружи:

```
node deploy/scripts/smoke-check.mjs https://dms.mig.uz --expect production
```

### TLS

- **Автоматически** (по умолчанию): `CADDY_TLS=<e-mail администратора>`. Caddy получает и продлевает сертификат
  Let's Encrypt (запасной — ZeroSSL); нужны DNS и открытые 80/443 из интернета. Сертификаты — в томе `caddy-data`.
- **Сертификаты МИГ**: положить `fullchain.pem` и `privkey.pem` в каталог на сервере (`chmod 600` ключ), указать
  `TLS_CERTS_DIR=/opt/mig-dms/certs` и `CADDY_TLS=/certs/fullchain.pem /certs/privkey.pem`. Замена сертификата —
  новые файлы и `docker compose … restart caddy`.
- `CADDY_TLS=internal` — собственный центр Caddy, только для локальных проверок.

### Staging

`APP_ENV=staging`: на пустой базе `deploy.sh` загружает демо-данные (тот же seed, что в CI, через демо-сброс API),
работают демо-маршруты; `DEMO_PASSWORD=Demo-2026!` — пароль новых учётных записей вместо письма. «Войти как…» и
тестовый код `000000` — только с `ALLOW_TEST_TOTP=true` и `NODE_ENV=staging` в `.env` (по умолчанию выключено; при
`APP_ENV=production` или `NODE_ENV=production` API с этим флагом не запускается). **Ключи ПДн на staging не задаются** (`PII_KEYS`, `PII_HMAC_KEY`, `SESSION_SECRET` пустые):
демо-данные зашифрованы опубликованным dev-ключом, поэтому на staging никогда не загружаются настоящие данные.
Сайт staging закройте доступом по VPN или по IP (как Cloudflare Access у демо-сайта). Пересоздать демо-данные:
`RESEED=1 deploy/scripts/deploy.sh`.

### Production

`APP_ENV=production`, `API_REPLICAS=4` (на 8 vCPU; один процесс API занимает одно ядро — `docs/backend/LOAD.md`): API не запускается без `PII_KEYS`, `PII_HMAC_KEY`, `SESSION_SECRET`, `SMS_HOOK_SECRET` и с
опубликованными dev-значениями; `DEMO_PASSWORD` должен быть пустым; демо-маршрутов, демо-кодов и демо-данных нет.

## 4. Секреты

Все секреты — только в файле окружения сервера (и в хранилище паролей МИГ). `gen-secrets.sh` делает их так:

| Переменная                     | Как сгенерировать вручную                                             |
| ------------------------------ | --------------------------------------------------------------------- |
| `POSTGRES_PASSWORD`            | `openssl rand -hex 24`                                                |
| `JWT_SECRET`                   | `openssl rand -base64 48`                                             |
| `ANON_KEY`, `SERVICE_ROLE_KEY` | JWT HS256 на `JWT_SECRET` с `role` = `anon` / `service_role` (скрипт) |
| `DASHBOARD_PASSWORD`           | `openssl rand -hex 16`                                                |
| `PII_KEYS`                     | `1:$(openssl rand -base64 32)`; `PII_KEY_CURRENT=1`                   |
| `PII_HMAC_KEY`                 | `openssl rand -base64 48`                                             |
| `SESSION_SECRET`               | `openssl rand -base64 48`                                             |
| `SMS_HOOK_SECRET`              | `v1,whsec_$(openssl rand -base64 32)`                                 |
| `SMTP_*`                       | от почтовой службы МИГ                                                |
| `BACKUP_S3_*`                  | ключ доступа к бакету копий (только запись и чтение этого бакета)     |

**`PII_KEYS` и `PII_HMAC_KEY` храните ещё и вне сервера** (сейф/хранилище паролей): без них резервная копия не
читается — ПДн в базе и в копиях зашифрованы.

## 5. Первый администратор (production)

Демо-аккаунтов в production нет. Первого администратора создаёт администратор сервера:

```
cd /opt/mig-dms/app/deploy
docker compose --env-file /opt/mig-dms/production.env run --rm -T api \
  node deploy/scripts/create-admin.mjs --email it-admin@mig.uz --name "Фамилия Имя Отчество"
```

Скрипт создаёт пользователя Supabase Auth (e-mail подтверждён, роль `admin` в `app_metadata`), строку `staff` и
запись аудита; печатает **одноразовый пароль** один раз — передайте его лично. При первом входе портал покажет
QR для приложения-аутентификатора (TOTP). Остальных пользователей администратор заводит в портале
(«Администрирование → Пользователи»).

Аварийные действия (тот же скрипт, запись в аудит): `--reset-password` — новый одноразовый пароль,
`--reset-mfa` — удалить TOTP-факторы (новый подключается при следующем входе).

**Ограничение этапа 1.** Приглашения уходят письмом Supabase Auth, но ссылка из письма ведёт в Supabase Auth,
который наружу не открыт, а экрана «задать пароль по приглашению» во фронтенде ещё нет. До него новым учётным
записям с e-mail (сотрудники, HR, клиники, ассистансы) администратор сервера выдаёт одноразовый пароль:
`create-admin.mjs --email <адрес> --reset-password` (работает для любой учётной записи с e-mail, созданной в портале).

## 6. Доставка: два способа

### Вариант A. GitHub Actions + self-hosted runner (рекомендуется для production)

Runner сам подключается к GitHub исходящим соединением — входящие порты не нужны.

1. На сервере: пользователь `deploy` в группе `docker`; GitHub → Settings → Actions → Runners → New self-hosted
   runner → Linux; установить в `/opt/actions-runner` от пользователя `deploy`, при `config.sh` добавить метку
   `mig-staging` (на staging-сервере) или `mig-production` (на production); `sudo ./svc.sh install deploy && sudo ./svc.sh start`.
   Для публичного репозитория запретите запуск workflow из форков на self-hosted runner (Settings → Actions →
   Fork pull request workflows) — наши workflow и так не запускаются на pull request.
2. GitHub → Settings → Environments:
   - `staging` — без ограничений (или только ветка `main`);
   - `production` — **Required reviewers** (кто подтверждает выкладку), Deployment branches: `main` и теги.
3. GitHub → Settings → Secrets and variables → Actions → **Variables** (секретов в GitHub не нужно — они на сервере):

   | Переменная               | Значение                                                                                                              |
   | ------------------------ | --------------------------------------------------------------------------------------------------------------------- |
   | `STAGING_ENABLED`        | `true` — включает автодеплой staging                                                                                  |
   | `STAGING_DOMAIN`         | `staging.dms.mig.uz`                                                                                                  |
   | `STAGING_ENV_FILE`       | `/opt/mig-dms/staging.env` (по умолчанию)                                                                             |
   | `PRODUCTION_ENABLED`     | `true` — включает ручной деплой production                                                                            |
   | `PRODUCTION_DOMAIN`      | `dms.mig.uz`                                                                                                          |
   | `PRODUCTION_ENV_FILE`    | `/opt/mig-dms/production.env` (по умолчанию)                                                                          |
   | `RESTORE_CHECK_ENABLED`  | `true` — ежемесячная проверка восстановления на staging                                                               |
   | `RESTORE_CHECK_ENV_FILE` | `/opt/mig-dms/restore-check.env` (по умолчанию): только `BACKUP_S3_*` с ключом **только на чтение** бакета production |

   Пока переменные не заданы, workflow ничего не делают (задачи пропускаются, CI остаётся зелёным).

4. Как это работает:
   - `.github/workflows/deploy-staging.yml` — после зелёного CI на push в `main` (событие `workflow_run`) runner
     staging берёт этот коммит и запускает `deploy/scripts/deploy.sh`, затем `smoke-check.mjs --expect staging`.
   - `.github/workflows/deploy-production.yml` — только вручную (Actions → Deploy production → Run workflow,
     поле `ref` — коммит/тег, проверенный на staging), ждёт подтверждения в Environment `production`, затем
     `deploy.sh --backup`: **резервная копия до миграций** (если она не удалась — ничего не мигрируется),
     миграции, запуск, `smoke-check.mjs --expect production`. Поле `rollback_to` — откат на образы прежнего коммита.
   - `.github/workflows/restore-check.yml` — 3-го числа каждого месяца (и вручную).

### Вариант B. Coolify

1. Установить Coolify на сервер (или отдельный сервер управления, подключающий этот по SSH); в настройках Coolify
   закрыть его панель от интернета (VPN/IP) — наружу по-прежнему только 80/443.
2. Coolify сам занимает 80/443 своим прокси (Traefik). Два варианта: (а) отключить прокси Coolify для этого сервера
   (Servers → Proxy → None) — тогда наш Caddy публикует 80/443 как в варианте A; (б) оставить прокси Coolify,
   задать в окружении `PUBLISH_ADDR=127.0.0.1`, `HTTP_PORT=8080`, `HTTPS_PORT=8443` и направить домен Coolify на
   `https://127.0.0.1:8443` (TLS тогда завершает Coolify; заголовки всё равно ставит наш Caddy). Рекомендуем (а).
3. New Resource → Docker Compose → репозиторий, ветка `main` (staging) или тег (production), путь
   `deploy/docker-compose.yml`, Base directory — корень репозитория.
4. Environment Variables — всё из `.env.example` (секреты — `gen-secrets.sh` на любой машине), отметить их как
   секретные.
5. Coolify выполняет `docker compose up -d --build`: разовый сервис `migrate` применяет миграции до старта `api`
   (`api` ждёт его успешного завершения). Staging: Auto Deploy по push в `main`; демо-данные — вручную один раз:
   `docker compose exec api node -e "fetch('http://127.0.0.1:8787/api/__demo/reset',{method:'POST',headers:{'content-type':'application/json','x-requested-with':'mig-web'},body:'{}'})"`.
6. Production: Auto Deploy выключен, деплой кнопкой. **Резервная копия перед миграциями** в Coolify не делается
   сама: перед каждым деплоем production запускайте на сервере `deploy/backup/run-backup.sh` (или используйте
   вариант A — там это встроено).
7. Резервные копии и проверку восстановления настраивайте по разделу 8 (cron на сервере) — независимо от Coolify.

## 7. Миграции и демо-данные

- Миграции — только SQL из `supabase/migrations/` (генерируются `npm run db:gen`, правятся только новым файлом).
  `migrate.sh` применяет каждый файл один раз, в своей транзакции, и записывает его в
  `supabase_migrations.schema_migrations` (та же таблица, что у `supabase db push`). Ошибка — откат этого файла и
  остановка; остальное не применяется.
- Статус: `docker compose --env-file … run --rm migrate --status`.
- Миграции идут только вперёд. Откат миграции = восстановление копии, сделанной перед ней (production делает её
  автоматически, раздел 8).
- Демо-данные — **только staging** (`APP_ENV=staging`, демо-сброс API). В production демо-маршрутов нет — загрузить
  seed туда технически нельзя; `supabase/seed.sql` в production не применяется никогда.

## 8. Резервные копии и восстановление

### Ежедневно

`deploy/backup/run-backup.sh` (cron root):

```
15 2 * * * ENV_FILE=/opt/mig-dms/production.env /opt/mig-dms/app/deploy/backup/run-backup.sh >> /var/log/mig-backup.log 2>&1
```

1. `backup.sh` в контейнере `postgres:15.19-alpine3.24` пишет в `BACKUP_DIR/daily/<время UTC>/`:
   `app.dump` (`pg_dump -Fc` наших схем `public`, `app`, `supabase_migrations` — таблицы, функции, RLS, данные),
   `platform.dump` (данные Supabase Auth, Storage и заданий pg_cron), `storage.tar.gz` (файлы Storage),
   `manifest.txt`, `SHA256SUMS`. Первая копия месяца — ещё и в `monthly/<ГГГГ-ММ>/` (жёсткие ссылки).
   Хранение: **30 дневных и 12 месячных** (`BACKUP_KEEP_DAILY`, `BACKUP_KEEP_MONTHLY`).
2. Копия в отдельное хранилище: S3-совместимый бакет (`BACKUP_S3_*`, сервис `offsite` с `rclone copy` в
   `<бакет>/<APP_ENV>/…`; удаление старых копий в бакете — правилом жизненного цикла бакета, лучше с версионированием
   или object lock, чтобы взломанный сервер не мог удалить копии) или rsync по SSH (`BACKUP_RSYNC_TARGET`,
   зеркало локального каталога). Без них скрипт завершается с кодом 2: копия только на этом же сервере — не копия.

ПДн в копиях зашифрованы (ключи — только в окружении сервера), но копии всё равно конфиденциальны.

### Восстановление на чистый сервер

1. Новый сервер по разделам 1–3, **но без** `deploy.sh`: рабочая копия на том же релизе, что сделал копию; файл
   окружения с **теми же `PII_KEYS` и `PII_HMAC_KEY`** (остальные секреты можно сгенерировать заново —
   пользователи просто войдут заново).
2. `ENV_FILE=/opt/mig-dms/production.env deploy/backup/restore.sh --latest-offsite production`
   (или `restore.sh <каталог копии>`).

   Скрипт собирает образы, поднимает `db`, `auth`, `rest`, `storage` на пустых томах (Auth и Storage создают свои
   схемы теми же версиями образов), останавливает Auth и Storage, восстанавливает данные Auth/Storage/pg_cron,
   наши схемы и файлы Storage, **сверяет** число строк каждой таблицы с копией и цепочку хэшей аудита
   (`app.verify_audit_chain()`), затем запускает весь стек и применяет миграции более нового релиза, если они есть.

3. Переключить DNS на новый сервер, включить cron копий.

### Ежемесячная проверка восстановления (на staging)

`deploy/backup/restore-check.sh --latest-offsite production` берёт последнюю копию production из бакета (ключ
только на чтение), восстанавливает её в **одноразовый** стек (свой проект Compose, тома и сеть, без портов,
сгенерированные секреты), проверяет то же, что `restore.sh`, и удаляет стек. Рабочий staging не затрагивается.
Запуск: workflow `restore-check.yml` (3-го числа) или cron на staging-сервере:

```
40 3 3 * * SERVER_ENV_FILE=/opt/mig-dms/restore-check.env /opt/mig-dms/app/deploy/backup/restore-check.sh --latest-offsite production >> /var/log/mig-restore-check.log 2>&1
```

Результат (последняя строка `restore-check: OK`) записывайте в журнал проверок МИГ; код ≠ 0 — разбор в тот же день.

### Проверка скриптов локально и в CI

`deploy/backup/test-local.sh` — дамп работающей локальной базы (`npx supabase start`, `db reset`) → восстановление
в одноразовый стак → сверка. `deploy/scripts/smoke-test.sh` — весь стек в режиме production + копия + её
восстановление. Оба запускает задача CI `deploy`.

## 9. Studio (по необходимости)

```
docker compose -f docker-compose.yml -f docker-compose.studio.yml --env-file … --profile studio up -d
ssh -N -L 8000:127.0.0.1:8000 deploy@<сервер>      # на компьютере администратора; затем http://127.0.0.1:8000
docker compose … --profile studio stop studio meta  # после работы
```

Kong (и через него Studio с паролем `DASHBOARD_USERNAME`/`DASHBOARD_PASSWORD`) публикуется только на `127.0.0.1`
сервера. Studio даёт полный доступ к базе в обход API — только для разбора инцидентов, изменения схемы — только
миграциями.

## 10. Ротация секретов

Общий порядок: новое значение в файле окружения → `deploy/scripts/deploy.sh` (или
`docker compose --env-file … up -d <сервисы>`) → проверка `smoke-check.mjs` → старое значение удалить из хранилища
паролей. Записывайте дату ротации.

| Секрет                                          | Процедура                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Последствия                                                        |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `PII_KEYS` / `PII_KEY_CURRENT`                  | добавить новую версию: `PII_KEYS=1:<старый>,2:<новый>`, `PII_KEY_CURRENT=2`, перезапустить `api` и `worker`. Новые и изменённые значения шифруются версией 2, старые читаются версией 1. **Перешифрование старых строк** (план): служебная задача, которая пакетами читает строки с `*_key_ver` < текущей, расшифровывает старым ключом, шифрует текущим и обновляет `*_enc`/`*_key_ver` (без изменения `*_hmac`), с записью в аудит; после того как `select count(*) … where *_key_ver < 2` по всем таблицам с ПДн = 0 и сделана новая резервная копия, версию 1 убирают из `PII_KEYS`. Задача — этап 2; до неё старый ключ остаётся в `PII_KEYS`. При компрометации ключа — внеплановая ротация с этой задачей в приоритете. | простоя нет                                                        |
| `PII_HMAC_KEY`                                  | хэши поиска (`pinfl_hmac`, `phone_hmac`) зависят от ключа: смена требует пересчитать их для всех строк (та же служебная задача: расшифровать → HMAC новым ключом) в окне обслуживания, пока API остановлен. Только при компрометации.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | окно обслуживания                                                  |
| `SESSION_SECRET`                                | новое значение, перезапуск `api`, `worker`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | все BFF-сессии недействительны — пользователи входят заново        |
| `JWT_SECRET` (+ `ANON_KEY`, `SERVICE_ROLE_KEY`) | `gen-secrets.sh` на пустых значениях этих трёх ключей (`--fill` подпишет новые ключи новым секретом); `deploy.sh` перезапускает всё. `app.settings.jwt_secret` в базе: `docker compose exec db psql -U supabase_admin -c "alter database postgres set app.settings.jwt_secret to '<новый>'"`                                                                                                                                                                                                                                                                                                                                                                                                                                   | текущие access-токены недействительны — пользователи входят заново |
| `SMS_HOOK_SECRET`                               | новое значение `v1,whsec_…` и одновременный перезапуск `auth` и `api` (`up -d auth api worker`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | SMS-коды недоступны несколько секунд                               |
| `POSTGRES_PASSWORD`                             | `docker compose exec db psql -U supabase_admin` → `alter user postgres/supabase_admin/authenticator/supabase_auth_admin/supabase_storage_admin/pgbouncer with password '<новый>'` (каждого), затем новое значение в файле и `deploy.sh`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | перезапуск сервисов                                                |
| `DASHBOARD_PASSWORD`                            | новое значение, `up -d kong`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | —                                                                  |
| `SMTP_*`                                        | новые данные почты, `up -d auth`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | —                                                                  |
| `BACKUP_S3_*`                                   | новый ключ в хранилище, затем в файле окружения (и `restore-check.env`), старый отозвать                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | —                                                                  |
| TLS-сертификаты МИГ                             | новые файлы в `TLS_CERTS_DIR`, `restart caddy`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | —                                                                  |

## 11. Журналы и мониторинг

- Журналы контейнеров: `docker compose --env-file … logs -f api worker caddy auth` (JSON, ротация 5 × 20 МБ на
  контейнер). Журнал доступа Caddy — без строк запроса (в поиске может быть ФИО), без cookie.
- Состояние: `docker compose ps` (у всех сервисов healthcheck), `docker stats`.
- Что отслеживать (Zabbix/Prometheus МИГ или хотя бы cron с почтой): доступность `https://<домен>/` и
  `https://<домен>/api/auth/me` (ожидается 401); срок сертификата; свободное место (`df -h`, тома Docker);
  `/var/log/mig-backup.log` (ежедневная строка `copied to …`); ежемесячный `restore-check: OK`; ежедневная проверка
  цепочки аудита pg_cron (уведомление администратору МИГ в портале при разрыве).
- Нагрузка и запас — `docs/backend/LOAD.md`; повторить замер: `scripts/loadtest.mjs` против staging.

## 12. Обновление и откат

- Обновление staging — автоматически после CI (вариант A) или Auto Deploy (Coolify).
- Обновление production — workflow «Deploy production» с тегом/коммитом, проверенным на staging; вручную:
  `git fetch && git checkout <тег> && ENV_FILE=… deploy/scripts/deploy.sh --backup`.
- Откат кода: `deploy/scripts/deploy.sh --rollback <12 символов коммита>` (образы прежних релизов остаются на
  сервере; чистка — `docker image prune` вручную, оставляя 3–5 последних). Откат возможен, только если новый релиз
  не применил несовместимых миграций; иначе — восстановление копии, сделанной перед миграциями (раздел 8),
  на этом же сервере: остановить стек, `docker compose … down -v` **после того как копия проверена**, `restore.sh`.
- Обновление образов Supabase/Caddy/Node — PR с новыми тегами в `docker-compose.yml`/`Dockerfile`, CI (задачи
  `api`, `e2e-backend`, `deploy`), staging, затем production.
