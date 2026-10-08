<!-- Tarjima MIG tomonidan tekshirilishi kerak. Belgilash (koʻrinmaydi): sarlavhadan keyingi "{#anchor}" — uning oʻzgarmas lotin langari; "audience: ..." izohlari qismni kim oʻqishi mumkinligini bildiradi (src/shared/help/audience.ts). Ikkalasi ham USER_GUIDE.ru.md dagidek saqlanadi. -->

# MIG ITS tizimi foydalanuvchi qoʻllanmasi

Versiya 1.0 · 07.10.2026 · Tarjima MIG tomonidan tekshirilishi kerak

## 1. Tizim haqida {#about}

<!-- audience: all -->

MIG ITS tizimi ixtiyoriy tibbiy sugʻurtaning barcha ishtirokchilarini bitta veb-ilovada birlashtiradi: MIG, mijoz kompaniyalar, ularning xodimlari va oila aʼzolari, klinikalar va assistans kompaniyalari. Har kim oʻz portalida ishlaydi va faqat roliga koʻra ruxsat etilgan narsalarni koʻradi.

| Portal | Manzil | Kim ishlaydi | Nima uchun |
| --- | --- | --- | --- |
| MIG portali | `/staff` | MIG xodimlari: sotuv, anderrayting, yuristlar, zararlarni tartibga solish, ekspert shifokorlar, buxgalteriya, administratorlar | Mijozlar va bitimlar, kotirovkalar, tijorat takliflari, shartnomalar, polislar, zararlar, hisoblar, hisobotlar, tizim sozlamalari |
| Assistans portali | `/assist` | Assistans kompaniyalari xodimlari | Qoʻngʻiroqlar markazi, shifokor qabuliga yozish, kafolat xatlari, klinika reyestrlarini tekshirish, klinikalarga toʻlov, MIGga hisoblar |
| Klinika kabineti | `/clinic` | Hamkor klinikalarning registraturasi va maʼmuriyati | Bemorni tekshirish, qabullar, kafolat xatlari, reyestrlar, oʻz tibbiy tizimini ulash |
| HR kabineti | `/hr` | Mijoz kompaniyalarning masʼul xodimlari | Xodimlar va oila aʼzolari roʻyxatlari, imzolash uchun tijorat takliflari va shartnomalar, hisoblar, hujjatlar, statistika |
| Sugʻurtalangan shaxs ilovasi | `/app` | Mijozlarning xodimlari va ularning oila aʼzolari | Polis va sertifikat, limitlar, shifokor qabuliga yozilish, chek boʻyicha qoplash, «Qoplanadimi?» savoli, chat |

**Portallar qanday bogʻlangan.** Hammasida bitta umumiy baza. Bir portaldagi harakat darhol boshqalarida koʻrinadi: sugʻurtalangan shaxs shifokor qabuliga yozildi — ariza klinikada va assistansda paydo boʻldi; HR xodim qoʻshdi — u ilovaga kirish huquqini oldi, assistans esa uni oʻz roʻyxatida koʻrdi; klinika reyestr yubordi — qatorlar toʻlovchiga tekshiruvga keldi.

**Kirishning asosiy tamoyili.** Har kim faqat oʻzinikini koʻradi: sugʻurtalangan shaxs — oʻz polisi va farzandlarini, HR — oʻz kompaniyasi xodimlarini tibbiy maʼlumotlarsiz, klinika — bemorni faqat uning polisini tekshirgandan keyin, assistans — faqat oʻz mijozlarining sugʻurtalanganlarini, MIG xodimi — roli uchun kerakli narsalarni. Shaxsga doir va tibbiy maʼlumotlarni koʻrish audit jurnaliga yoziladi.

**Qoʻllanmani qanday oʻqish kerak.** Boʻlimlar 5–12 biznes-jarayonlarni yangi mijozdan toʻlovlargacha bosqichma-bosqich tavsiflaydi. Boʻlimlar 13–14 — har bir rol oʻz portalida nima qiladi. Boʻlimlar 15–16 — administratorlar uchun. Boʻlim 17 — odatiy vaziyatlarda nima qilish kerak. Boʻlimlar 18–19 — xavfsizlik qoidalari va holatlar maʼlumotnomasi. Hujjat tizimning soxta maʼlumotlardagi prototipini tavsiflaydi; tugmalar nomlari oʻzbekcha interfeys boʻyicha berilgan.

## 2. Ishni boshlash {#getting-started}

<!-- audience: all -->

MIG xodimlari, HR, klinikalar va assistanslar email, parol va bir martalik kod bilan kiradi; sugʻurtalangan shaxslar — telefon raqami va SMS koddan foydalanib.

### Kirish {#login}

<!-- audience: all -->

1. **Xodimlar va hamkorlar.** Tizim manzilini oching, ish emailingiz va parolni, soʻngra ikkinchi omilning 6 xonali kodini (MFA) kiriting. Kodni buferdan toʻliq qoʻyish mumkin.
2. **Sugʻurtalangan shaxslar.** Ilovani oching, telefon raqamini +998 XX XXX XX XX formatida kiriting, «Kodni olish» tugmasini bosing va SMS dagi kodni kiriting. Birinchi kirishda shaxsga doir maʼlumotlarni qayta ishlashga rozilik berish kerak.
3. **Voyaga yetgan oila aʼzolari** (turmush oʻrtogʻi, ota-onasi) oʻz telefon raqami bilan kiradi. Chegaraviy yoshgacha boʻlgan bolalar ota-onasining ilovasida koʻrinadi va alohida kirishga ega emas.
4. 10 daqiqa ichida 5 marta notoʻgʻri urinishdan soʻng kirish 5 daqiqaga bloklanadi. Xato haqidagi xabar aynan nima notoʻgʻri ekanini aytmaydi — bu taxmin qilib topishdan himoya.

### Portal ekrani {#portal-screen}

<!-- audience: all -->

- **Chapdagi yon panel** — maʼnosi boʻyicha guruhlangan boʻlimlar: «Ish», «Sotuv va anderrayting», «Tartibga solish», «Hamkorlar», «Moliya», «Hisobotlar», «Maʼmuriyat». Faqat rolingizga ochiq boʻlimlar koʻrinadi. Oʻngdagi raqam — boʻlimda nechta vazifa kutayotgani.
- **Panelni yashirish yoki koʻrsatish** — chap yuqori burchakdagi tugma yoki Ctrl+B (Mac da ⌘+B). Panel yashirilgan boʻlsa, sichqonchani tugma ustiga olib boring — panel tarkib ustidan chiqadi; bosish uni mahkamlaydi. Panel kengligini uning oʻng chetini sudrab oʻzgartirish mumkin; chetiga ikki marta bosish odatiy kenglikni qaytaradi. Tizim tanlovingizni eslab qoladi.
- **Qidiruv** — yuqoridagi maydon yoki Ctrl+K. Mijozlarni nomi va STIR boʻyicha, polislar va shartnomalarni raqami boʻyicha (koʻchirilgan shartnomalarning eski raqamlari ham), sugʻurtalanganlarni F.I.Sh. boʻyicha, zararlarni raqami boʻyicha, shuningdek menyu boʻlimlarini topadi. Kirill yozuvida yozish mumkin: «Ташкент» «Toshkent» ni topadi.
- **«+ Yaratish»** — oʻng yuqoridagi tugma yoki C tugmasi. Rolingiz nimani yarata olishini koʻrsatadi. Kulrang bandlar avtomatik yaratiladi — maslahat ular qayerdan paydo boʻlishini tushuntiradi.
- **Til** — yuqoridagi RU / UZ / EN tugmasi yoki panel pastidagi foydalanuvchi menyusi. Interfeys tili oʻzgaradi; kompaniyalar nomlari, F.I.Sh. va hujjat raqamlari oʻzgarmaydi, hujjatlar (tijorat takliflari, shartnomalar) esa oʻz til tanloviga ega.
- **Foydalanuvchi menyusi** — panel pastida: profil, til, «Chiqish».
- Yuqoridagi **«MFA · VPN» indikatori** kirish himoyalanganini koʻrsatadi.

### Jadvallar va kartalar {#tables}

<!-- audience: all -->

- Ustun sarlavhasiga bosish saralaydi, jadval ustidagi tugmalar filtrlaydi. Ustun nomlari qatori aylantirishda koʻrinib turadi.
- Qatorga bosish oʻngda kartani ochadi. ↑ va ↓ strelkalari yozuvlarni almashtiradi, Enter toʻliq kartani ochadi, Esc yopadi. Bunda jadval ochiq qoladi.
- Yon ustunlar — oʻngdagi karta, ish stoli bloklari («Eʼtibor talab qiladi», «Integratsiyalar»), kartalardagi maʼlumotlar va tarix, TT va shartnoma muharrirlaridagi hujjatni oldindan koʻrish — sahifa aylantirilganda joyidan siljimaydi. Uzun ustun oʻzi aylanadi: ustun sarlavhasi va tugmalari joyida qoladi, joriy boʻlim sarlavhasi esa butun boʻlim aylanib oʻtguncha ustun sarlavhasi ostida turadi. Kengligi 1280 pikseldan kichik ekranda karta jadval ustidan ochiladi, boshqa ustunlar esa asosiy mazmun ostiga tushadi.
- «Ustunlar» tugmasi keraksiz ustunlarni yashiradi, «CSV ga eksport» jadvalni yuklab beradi (JShShIR, telefonlar va tashxislarsiz).

### Boʻsh boʻlimlardagi maslahatlar {#empty-hints}

<!-- audience: all -->

Roʻyxat, yorliq yoki boʻlim maʼlumotlar hali kiritilmagani uchun boʻsh boʻlsa, tizim «Maʼlumot yoʻq» demaydi, keyingi qadamni koʻrsatadi:

- **nega boʻsh** — bosqich va holatni hisobga olgan holda (lid uchun: «Sugʻurtalanganlar shartnoma kuchga kirgandan keyin paydo boʻladi»);
- **nima qilish kerak va kim masʼul** — rol nomi;
- **amal tugmasi**, agar buni oʻzingiz qila olsangiz: u toʻgʻridan-toʻgʻri kerakli joyga, ochiq shakl bilan olib boradi (masalan, baholash maʼlumotlari yoki 2-ilova faylini tanlash), fayl kerak boʻlsa yonida — «Shablonni yuklab olish»;
- **«{rol}dan soʻrash»**, agar boshqa xodim masʼul boʻlsa: izohingiz bilan soʻrov masʼul xodimga (bitim yoki mijoz menejeriga, kotirovka anderrayteriga), u boʻlmasa — ushbu roldagi barcha xodimlarga yuboriladi. U ish stolidagi navbatda, «Hamkasblardan vazifalar» yorligʻida va ijrochining qoʻngʻiroqchasida paydo boʻladi. Obyektda tugma oʻrnida «… soʻrovi {sana} yuborildi — {kimga}, {holat}» plashkasi, soʻrovning oʻzi esa «Mening soʻrovlarim» yorligʻingizda paydo boʻladi («Hamkasblarga soʻrovlar» boʻlimi); <!-- audience: staff hr -->
- **«HRdan soʻrash»**, agar maʼlumotni mijoz berishi kerak boʻlsa: vazifa HR kabinetida «MIGdan vazifalar» blokida paydo boʻladi. Mijozda hali kabinet boʻlmasa (TTgacha lid), CSV shabloni bilan tayyor xat ochiladi — matnni nusxalab, oʻz pochtangizdan yuboring; <!-- audience: staff -->
- **«Batafsil maʼlumotnomada»** — ushbu qadam haqidagi qoʻllanma boʻlimi.

Agar roʻyxat filtrlar yoki qidiruv sababli boʻsh boʻlsa, avvalgidek «Hech narsa topilmadi» koʻrsatiladi.

### Bildirishnomalar qoʻngʻiroqchasi {#notifications}

<!-- audience: all -->

Yuqori paneldagi qoʻngʻiroqcha barcha portallarda bor. Undagi raqam — siz hali oʻqimagan bildirishnomalar soni.

- **Nima keladi:** sizga yangi soʻrov («{Muallif} soʻraydi: {nima} — {obyekt}»), soʻrovingizga javob (ishga olindi, bajarildi, rad etildi — ijrochi izohi bilan), «Ertaga soʻrov muddati», «Soʻrov muddati oʻtdi» va muallif eslatmalari.
- **Bildirishnomani bosish** obyektni — bitim, shartnoma, mijoz kartasi yoki amal kerak boʻlgan shaklni — ochadi va shu bildirishnomani oʻqilgan deb belgilaydi.
- **«Hammasini oʻqilgan deb belgilash»** roʻyxat tepasida hisoblagichni nolga tushiradi.

### Hamkasblarga soʻrovlar va «Mening soʻrovlarim» {#requests}

<!-- audience: staff -->

Soʻrov — hamkasbdan siz emas, u bajara oladigan qadamni bajarishni soʻrash: masalan, anderrayter menejerdan baholash maʼlumotlarini yuklashni soʻraydi. Soʻrovlar boʻsh boʻlimlarda va bitim roʻyxatida «{rol}dan soʻrash» va «HRdan soʻrash» tugmalari bilan yuboriladi.

- **Kimga boradi.** Obyekt uchun masʼul xodimga: bitim yoki mijoz menejeriga, kotirovka anderrayteriga. Masʼul boʻlmasa, soʻrovni ushbu roldagi barcha xodimlar koʻradi; birinchi boʻlib «Ishga olish»ni bosgan ijrochi boʻladi, qolganlarda qator yoʻqoladi.
- **Bir vaqtda bitta soʻrov.** Soʻrov ochiq ekan, obyektda tugma oʻrnida «… soʻrovi {sana} yuborildi — {kimga}, {holat}» plashkasi koʻrinadi va shu obyekt boʻyicha xuddi shu soʻrovni yuborib boʻlmaydi.
- **Javob muddati** — «DMS parametrlari»da ular ikkita, ikkalasi ham «demo-qiymat» belgisi bilan: «Ichki soʻrovga javob muddati» — MIG xodimlari oʻrtasida (demo: 2 ish kuni), «Mijozning MIG soʻroviga javob muddati» — HRga soʻrovlar uchun (demo: 5 ish kuni). Muddatdan bir kun oldin va muddat oʻtganda ijrochi ham, muallif ham bildirishnoma oladi. Muddati oʻtgan soʻrov ikkalasida ham qizil rangda.
- **«Eslatish».** Muddat oʻtganda plashkada va «Mening soʻrovlarim»da «Eslatish» tugmasi paydo boʻladi: ijrochi takroriy bildirishnoma oladi, soʻrov tarixida belgi paydo boʻladi.
- **Tarix.** Soʻrov yuborilishi va har bir holat oʻzgarishi bitim «Hodisalar»iga va mijoz «Faollik»iga yoziladi.

**Ijrochi.** Soʻrov ish stoli navbatida, «Hamkasblardan vazifalar» yorligʻida koʻrinadi. Qatorda — «Ishga olish», «Ochish» va «Rad etish» (izoh majburiy, muallif uni koʻradi). Ishga olingan soʻrov amal bajarilganda (masalan, baholash maʼlumotlari yuklanganda) oʻzi yopiladi yoki qoʻlda — izoh bilan «Bajarilgan deb belgilash».

**Muallif.** Ish stolida «Mening soʻrovlarim» yorligʻi: nima, kimga, qaysi obyekt boʻyicha, qachon yuborilgan, muddat, holat (kutmoqda, ishda, bajarildi, rad etildi) va ijrochi izohi.

### Maʼlumotnoma {#using-help}

<!-- audience: all -->

Maʼlumotnoma yon panel pastidagi «Maʼlumotnoma» bandi, yuqori paneldagi «?» belgisi (joriy ekran haqidagi maqolada) yoki ilovada profildagi «Yordam» bandi orqali ochiladi. Siz faqat rolingiz uchun mavjud maqolalarni koʻrasiz.

- **Yuqorida bitta maydon — «Atamani toping yoki savol bering».** Yozayotganingizda maydon ostida natijalar chiqadi: «Atamalar» va «Maqolalar», moslik ajratib koʻrsatiladi.
- **Roʻyxatning birinchi qatori — «Soʻrash: «…»».** U yoʻriqnoma-javob beradi: qisqa javob, qadamlar, ogohlantirishlar, kichik boʻlimlarga «Batafsil» havolalari va «Boʻlimni ochish» tugmalari. Javob ostida — «Foydali» yoki «Foydali emas».
- **Savolga javob oʻzi beriladi.** Matn savolga oʻxshasa — «?» bilan tugasa, «qanday», «qayerda», «nima», «kim», «nega», «qachon» (shuningdek ruscha va inglizcha savol soʻzlari) soʻzlari bilan boshlansa yoki besh soʻzdan uzun boʻlsa — yozishda toʻxtaganingizdan keyin javob natijalar ustida karta boʻlib chiqadi. Qisqa soʻrov («STIR», «JShShIR») faqat qidiradi.
- **Klaviatura:** ↑ va ↓ — qatorlar boʻylab, qatorda Enter — uni ochish, qator tanlanmagan holda Enter — soʻrash, Esc — roʻyxatni yopish.
- **Javob boʻlmasa**, maʼlumotnoma buni ochiq aytadi — «Maʼlumotnomada bu savolga javob yoʻq» — va kuratorga (yoki portalingiz qoʻllab-quvvatlash xizmatiga) yozishni taklif qiladi.
- **Javoblar administrator tomonidan oʻchirilgan boʻlsa**, «Soʻrash» qatori boʻlmaydi, qidiruv ishlaydi.
- **«PDF yuklab olish»** — butun maʼlumotnoma yoki joriy maqola, faqat rolingiz uchun mavjud boʻlimlar.
- MIG portalida **Ctrl+K**: «Maʼlumotnoma» guruhining birinchi qatori — «Maʼlumotnomadan soʻrash: «…»»; u maʼlumotnomani tayyor javob bilan ochadi. <!-- audience: staff -->

### Seans {#session}

<!-- audience: all -->

Faoliyatsizlikda tizim seansni tugatadi: MIG, klinikalar va assistanslar xodimlari uchun — 15 daqiqadan soʻng (2 daqiqa oldin ogohlantirish chiqadi), HR va sugʻurtalangan shaxslar uchun — 30 daqiqadan soʻng. Bitta varaqda chiqish barcha varaqlarda seansni tugatadi.

## 3. Atamalar va qisqartmalar lugʻati {#glossary}

<!-- audience: all -->

Tizimning asosiy atamalari va qisqartmalari; qavs ichida — agar farq qilsa, ular rus va ingliz interfeysida qanday koʻrinishi.

| Atama | Nimani anglatadi |
| --- | --- |
| **Anderrayter** | Xavfni baholaydigan, narxni (kotirovkani) hisoblaydigan va shartnomaning moliyaviy shartlarini tasdiqlaydigan MIG xodimi. |
| **Eng kam son** | MIG DMS shartnomasini tuzadigan kompaniya xodimlarining eng kam soni (demo: 10). Undan kam boʻlsa, kotirovka faqat izohli istisno sifatida tasdiqlanadi, istisnosiz shartnoma esa imzolanmaydi. |
| **Eʼtiroz** (апелляция, appeal) | Sugʻurtalangan shaxs yoki klinika tomonidan zarar boʻyicha qarorga eʼtiroz bildirish. Uni zararlar boʻyicha mutaxassis koʻrib chiqadi. |
| **Assistans, assistans kompaniyasi** | Kecha-kunduz ishlaydigan qoʻngʻiroqlar markazini yurituvchi, shifokor qabuliga yozadigan, kafolat xatlarini beradigan, klinika reyestrlarini tekshiradigan, klinikalarga toʻlaydigan va MIGga qoplash uchun hisob chiqaradigan MIG hamkori. Har bir assistans oʻziga biriktirilgan mijozlarga xizmat koʻrsatadi. |
| **Audit, audit jurnali** | Barcha muhim harakatlar yozuvi: kim, qachon va nima qildi yoki koʻrdi. MIG administratori koʻradi. |
| **Tashrif** (визит, visit) | Klinikaning bemor maʼlumotlariga 24 soatlik «ruxsatnomasi». Faqat klinika bemorning polisini QR kod, qisqa kod yoki JShShIR bilan polis raqami orqali tekshirgandagina ochiladi. |
| **Kafolat xati** (ГП, guarantee letter) | MIG yoki assistansning klinikaga qimmat xizmat (MRT, kasalxonaga yotqizish va h. k.) toʻlanishini summa va amal qilish muddati bilan tasdiqlashi. |
| **ITS — ixtiyoriy tibbiy sugʻurta** (ДМС, VHI) | Ixtiyoriy tibbiy sugʻurta. |
| **Shartnoma** | MIG va mijoz kompaniya oʻrtasidagi ITS shartnomasi. Asosiy matn va ilovalardan iborat: dastur, sugʻurtalanganlar roʻyxati, toʻlovlar jadvali, zarur boʻlsa stavkalar jadvali. |
| **Qoʻshimcha kelishuv** (ДС, endorsement) | Amaldagi shartnomaga oʻzgartirish: odamlarni kiritish yoki chiqarish, dasturni almashtirish, bekor qilish. Qoʻshimcha toʻlov yoki qaytarish hisobini oʻz ichiga oladi. |
| **Sugʻurtalangan shaxs** | Polis amal qiladigan inson: mijoz xodimi yoki uning oila aʼzosi. |
| **Oʻzgartirish arizasi** | Tarkib yoki shartlarning alohida oʻzgarishi (masalan, «xodimni 15.10 dan kiritish»). Arizalar toʻplanadi va qoʻshimcha kelishuv bilan rasmiylashtiriladi. |
| **Limitni oʻzgartirish** | Sugʻurtalangan shaxs limitini oshirish soʻrovi. Kurator yoki anderrayter yaratadi, boshqa anderrayter tasdiqlaydi. |
| **SI bilan qoplashni tekshirish** | Xizmat yoki dori qoplanadimi degan maslahat. Dastur qoidalari hal qiladi; SI faqat ifodani taniydi va javobni tushuntiradi. Rad etishni har doim inson qabul qiladi. |
| **KPI** | Ish koʻrsatkichlari, masalan assistansning oʻrtacha javob vaqti yoki muddatida qabul qilingan qarorlar ulushi. |
| **TT — tijorat taklifi** (КП, commercial proposal) | Mijozga taklif: hisob-kitobli xat va dastur broshyurasi. Faqat tasdiqlangan kotirovka boʻyicha yuboriladi. |
| **Kotirovka** | Anderrayter tomonidan mijoz xodimlari haqidagi maʼlumotlar asosida MIG tarifi boʻyicha sugʻurta narxini hisoblash. |
| **ITS kuratori** (куратор ДМС, VHI coordinator) | Assistanslar ishining sifatini kuzatadigan, shikoyatlar va eskalatsiyalarni koʻrib chiqadigan, assistanssiz mijozlarning qabullarini yuritadigan MIG xodimi. |
| **Lid** | Hali shartnomasi yoʻq boʻlgan potensial mijoz. |
| **Limit** | Dastur sugʻurtalangan shaxs uchun polis muddati davomida toifa boʻyicha (shifokorlar va tahlillar, stomatologiya, dori-darmonlar, statsionar) toʻlaydigan eng yuqori summa. «Tugayapti» — parametrlardagi chegaradan kam qoldi (demo: 20%). |
| **TAT — tibbiy axborot tizimi** (МИС, MIS) | Klinikaning tibbiy axborot tizimi — tizimga API orqali ulash mumkin boʻlgan oʻz dasturi. |
| **XKT-10** (МКБ-10, ICD-10) | Kasalliklarning xalqaro tasnifi; kafolat xatlari va reyestrlardagi tashxis kodi. |
| **MFA** | Ikki omilli kirish: parol va bir martalik kod. |
| **JShShIR** (ПИНФЛ, PINFL) | Jismoniy shaxsning shaxsiy identifikatsiya raqami, 14 ta raqam. Tizimda niqoblangan holda koʻrsatiladi. |
| **Imzolovchi** | MIG nomidan shartnomalar va qoʻshimcha kelishuvlarni imzolash huquqiga ega, ishonchnomali MIG xodimi. |
| **Polis** | Shartnoma boʻyicha amaldagi sugʻurta. Shartnoma imzolangan va toʻlangandan keyin avtomatik chiqariladi. |
| **Vakolatlar** | Xodimning shaxsiy limiti: masalan, anderrayterning eng katta chegirmasi yoki zarar boʻyicha qaror summasi. Vakolatlardan yuqori boʻlsa — kelishish. |
| **Sugʻurta dasturi** | Qoplamalar va limitlar toʻplami: Bazaviy, Standart, Standart+, Premium, GOLD (demo toʻplam). |
| **Reyestr, quyi reyestr** | Klinika koʻrsatgan xizmatlarning oylik roʻyxati. Tizim uni toʻlovchilar — assistanslar va MIG boʻyicha quyi reyestrlarga ajratadi. |
| **Zaxira** | MIG maʼlum qilingan, lekin hali tartibga solinmagan zarar uchun ajratib qoʻyadigan summa. |
| **Bitim** | Mijozning liddan amaldagi polisgacha yoki uzaytirishgacha boʻlgan yoʻli. |
| **Sertifikat** | Sugʻurtalangan shaxsning shaxsiy raqamli hujjati; ilovada va HR da mavjud. |
| **SLA** | Vazifa bajarilishi kerak boʻlgan muddat (masalan, klinikaning qabul arizasiga javobi). Muddati oʻtgani ajratib koʻrsatiladi. |
| **Sugʻurta qildiruvchi** (страхователь, policyholder) | Shartnoma tuzgan mijoz kompaniya. |
| **STIR** (ИНН, TIN) | Tashkilotning soliq toʻlovchining identifikatsiya raqami. |
| **Assistans hisobi** (qayta hisob chiqarish) | Assistansning MIGga oylik hisobi: klinikalarga toʻlangan summalar va assistansning mukofot puli. |
| **Zarar** (убыток, claim) | Tibbiy xizmatlar uchun toʻlov soʻrovi: chek boʻyicha qoplash, klinika hisobi, assistans hisobining qatori. |
| **Zararlilik darajasi** (убыточность, loss ratio) | Toʻlovlarning sugʻurta mukofotiga nisbati, foizda. 80% dan yuqori boʻlsa ajratib koʻrsatiladi. |
| **Zararlarni tartibga solish** | Zararni koʻrib chiqish va qaror: toʻliq toʻlash, qisman toʻlash yoki rad etish. |
| **Toʻrt koʻz** | Qoida: muhim harakatni bir xodim bajaradi, boshqasi tasdiqlaydi (masalan, assistans hisobini zararlar boʻyicha mutaxassis qabul qiladi, buxgalter esa toʻlaydi). |
| **Claims Officer** | MIGning zararlarni tartibga solish boʻyicha mutaxassisi. |
| **E-IMZO, ERI** (ЭЦП, e-signature) | Oʻzbekistonning elektron raqamli imzosi. |
| **EHA — elektron hujjat aylanishi** (ЭДО, EDI) | Operator orqali elektron hujjat aylanishi (masalan, Didox). |
| **IBNR** | Yuz bergan, lekin hali maʼlum qilinmagan zararlar zaxirasi. Aktuariy tomonidan tizimdan tashqarida hisoblanadi. |
| **PEPM** | Assistans mukofot puli modeli: bir oyda bitta sugʻurtalangan shaxs uchun qatʼiy summa. |
| **pro rata** | Shartnoma muddatining qolgan kunlariga mutanosib hisoblash. |

Uch tildagi atamalarning toʻliq roʻyxati repozitoriydagi `docs/i18n-glossary.md` lugʻatida yuritiladi.

## 4. Rollar va huquqlar {#roles}

<!-- audience: staff -->

Tizimda beshta portalda 16 ta rol bor. Rol qaysi boʻlimlar koʻrinishini va qaysi harakatlar mavjudligini belgilaydi; tekshiruv serverda bajariladi, shuning uchun begona boʻlimga toʻgʻridan-toʻgʻri havola «Ruxsat yoʻq» sahifasiga olib boradi.

### MIG xodimlari {#roles-staff}

<!-- audience: staff -->

| Rol | Asosiy vazifa | Nimani koʻrmaydi va qilmaydi |
| --- | --- | --- |
| Sotuv menejeri | Lidlar, bitimlar, maʼlumot yigʻish, tijorat takliflari va shartnomalarni yuborish, imzolash va toʻlovni nazorat qilish, qoʻshimcha kelishuvlarni shakllantirish | Narxni tasdiqlamaydi va MIG nomidan imzolamaydi (imzolovchi boʻlmasa) |
| Anderrayter | Kotirovkalar, narx, shartnomalar va qoʻshimcha kelishuvlarning moliyaviy shartlari, limit oʻzgarishlarini tasdiqlash, assistansni tayinlash | Alohida zararlarni koʻrmaydi — faqat umumlashgan zararlilik darajasini |
| Yurist | Oʻzgartirilgan bandli shartnomalar va qoʻshimcha kelishuvlarni kelishish, skanlarni tekshirish | Zararlar va tibbiy maʼlumotlarni koʻrmaydi |
| ITS kuratori | Assistanslarni nazorat qilish, shikoyatlar, eskalatsiyalar, assistanssiz mijozlarning qabullari | Zararlar boʻyicha qaror qabul qilmaydi |
| Zararlar boʻyicha mutaxassis (Claims Officer) | Zararlarni roʻyxatga olish, shartnoma bandiga havola bilan qarorlar, zaxiralar, firibgarlik, eʼtirozlar, assistans hisoblarini tekshirish | Shaxsiy vakolatlardan yuqori qarorlar kelishishga ketadi |
| Ekspert shifokor | Tibbiy xulosalar, assistans vakolatidan yuqori kafolat xatlari, sabab bilan tibbiy karta, nazorat tanlovi | Zarar boʻyicha qaror chiqarmaydi — faqat xulosa beradi |
| Buxgalter | Hisoblar, toʻlovlar, 1C koʻchirmasi, qoʻlda taqsimlash, assistanslar va klinikalar hisoblarini toʻlash | Oʻzi qabul qilgan hisobni toʻlay olmaydi |
| MIG administratori | Foydalanuvchilar, vakolatlar, parametrlar, hamkorlar, integratsiyalar, SI, audit, portfelni koʻchirish | Tibbiy maʼlumotlar va zararlar boʻyicha qarorlarga kirish yoʻq |

### Tashqi ishtirokchilar {#roles-external}

<!-- audience: staff -->

| Rol | Asosiy vazifa | Cheklovlar |
| --- | --- | --- |
| Mijoz kompaniya HR xodimi | Xodimlar va oila aʼzolari, ilovadan arizalar, imzolash uchun tijorat takliflari va shartnomalar, hisoblar, statistika | Faqat oʻz kompaniyasi; xodimlarning tashxislari, tashriflari va zararlarini koʻrmaydi; statistikada — faqat 10 kishidan iborat guruhlar |
| Sugʻurtalangan shaxs | Oʻz polisi, limitlar, qabulga yozilish, qoplash, chat, farzandlar maʼlumotlari | Voyaga yetgan oila aʼzolarining maʼlumotlarini ularning roziligisiz koʻrmaydi |
| Klinika registratori | Bemorni tekshirish, qabullar, kafolat xati soʻrovlari | Sugʻurtalanganlar bazasidan qidirmaydi; limit summalari va murojaatlar tarixini koʻrmaydi |
| Klinika administratori | Xuddi shu, qoʻshimcha ravishda reyestrlar, hujjatlar, klinika foydalanuvchilari, integratsiya | Faqat oʻz klinikasi |
| Assistans operatori | Murojaatlar, qabullar, chat, oʻz sugʻurtalanganlari boʻyicha qidiruv | Faqat hodisa sanasidagi oʻz mijozlarining sugʻurtalanganlari |
| Assistans shifokori | Assistans vakolati doirasidagi kafolat xatlari, reyestr qatorlarini tekshirish, sabab bilan tibbiy karta | Vakolatdan yuqori — MIGga eskalatsiya |
| Assistans moliyachisi | Klinikalarning quyi reyestrlari, klinikalarga toʻlovlar, MIG hisoblari | — |
| Assistans administratori | Assistans foydalanuvchilari va integratsiyasi | — |

### Umumiy qoidalar {#roles-rules}

<!-- audience: staff -->

- **Xodim vakolatlari.** Anderrayterlar va zararlar boʻyicha mutaxassislarning shaxsiy limitlari bor (chegirma, qaror summasi). Limitdan yuqori harakat avtomatik ravishda kattaroq vakolatlarga ega boʻlgan shu roldagi xodimga kelishishga ketadi.
- **Toʻrt koʻz.** Limitni oʻzgartirish boʻyicha oʻz soʻrovingizni oʻzingiz tasdiqlash, assistans hisobini bir vaqtda qabul qilish va toʻlash, parametrlar yoki vakolatlarni yakka oʻzgartirish yoki portfelni koʻchirishni qoʻllash mumkin emas.
- **Shaxsga doir maʼlumotlar** (JShShIR, telefon, tugʻilgan sana) niqoblangan holda koʻrsatiladi. Toʻliq qiymat «Koʻrsatish» tugmasi bilan sabab koʻrsatilib 30 soniyaga ochiladi va auditga tushadi.
- **Tibbiy karta** faqat ekspert shifokorga (MIG yoki assistans) sabab koʻrsatilib 15 daqiqaga ochiladi.

## 5. Yangi mijoz: liddan shartnomagacha {#new-client}

<!-- audience: staff hr -->

Yangi mijoz bitimning sakkiz bosqichidan oʻtadi: lid → baholash uchun maʼlumotlar → kotirovka → tijorat taklifi → shartnoma → imzolash → toʻlov → polis. Har bir hujjat oldingisidan yaratiladi, shuning uchun raqamlar ikki marta kiritilmaydi. Bitimning borishi «Bitimlar» doskasida va uning kartasi yuqorisidagi qadamlarda koʻrinadi.

### 1-bosqich. Lid {#lead}

<!-- audience: staff -->

**Kim:** sotuv menejeri.

1. «+ Yaratish» → «Mijoz (lid)» yoki «Mijozlar» → «+ Yangi mijoz».
2. Toʻldiring: rasmiy nomi **lotin yozuvida, reyestrdagidek, qoʻshtirnoqsiz**; tashkiliy-huquqiy shakl (MChJ, AJ, QK MChJ, XK, YaTT…) — u alohida tanlanadi; STIR; bank rekvizitlari; rahbar va uning vakolatlari asosi; HR bilan aloqa; taxminiy xodimlar soni; joriy sugʻurtalovchi.
3. Mijoz kartasida «Bitim yaratish» tugmasini bosing.

Agar lid bilan uzoq vaqt hech narsa sodir boʻlmasa (demo: 7 kun), menejer navbatida eslatma paydo boʻladi.

**Faqat kompaniyalar.** DMS MIG mijozi boʻlgan kompaniyalar xodimlari va ularning oila aʼzolari uchun rasmiylashtiriladi. YaTT shakli sukut boʻyicha ruxsat etilmaydi: bunday lid saqlanmaydi, «Shakl» maydoni ostida tushuntirish chiqadi. Ruxsat etilgan shakllar roʻyxatini «Sugʻurtalovchining ruxsat etilgan shakllari» parametri belgilaydi (MIG qarorini talab qiladi). Taxminiy son eng kam sondan kam boʻlsa (demo: 10 xodim), maydon ostida ogohlantirish chiqadi — lidni saqlash mumkin, lekin kotirovka keyin faqat istisno sifatida tasdiqlanadi.

### 2-bosqich. Baholash uchun maʼlumotlar {#census}

<!-- audience: staff -->

**Kim:** menejer.

1. Bitim kartasida «Baholash uchun maʼlumotlar» bosqichini oching va CSV shablonini yuklab oling.
2. Mijoz har bir inson boʻyicha toʻldiradi: jinsi, tugʻilgan yili, turi (xodim, turmush oʻrtogʻi, farzandi).
3. Faylni yuklang. Tizim yosh guruhlari boʻyicha taqsimotni, erkaklar va ayollar ulushini, oʻrtacha yoshni koʻrsatadi.

Bu bosqichda **ismlar, JShShIR va telefonlar kerak emas** — agar ular faylda boʻlsa, tizim ularni tashlab yuboradi va ogohlantiradi.

### 3-bosqich. Kotirovka {#quote}

<!-- audience: staff -->

**Kim:** anderrayter.

1. Bitimda kotirovka kalkulyatorini oching, dasturni tanlang.
2. Tizim sugʻurta mukofotini MIG tarifi boʻyicha hisoblaydi: dasturning bazaviy stavkasi × yosh guruhi koeffitsiyenti, guruh hajmi uchun chegirma bilan (barcha qiymatlar — «ITS parametrlari» da).
3. Zarur boʻlsa ustama yoki chegirma qoʻshing — izoh majburiy.
4. Natija: xodim uchun, oila aʼzosi uchun va umumiy sugʻurta mukofoti.
5. Agar chegirma yoki sugʻurta mukofoti vakolatlaringizdan yuqori boʻlsa, kotirovka anderrayting rahbariga kelishishga ketadi. Aks holda «Tasdiqlash» tugmasini bosing.

### 4-bosqich. Tijorat taklifi {#kp}

<!-- audience: staff hr -->

<!-- audience: staff -->
**Kim:** menejer yoki anderrayter. Tijorat taklifini **faqat tasdiqlangan kotirovka boʻyicha** yuborish mumkin.

1. Bitimda, mijoz kartasida yoki ish stoli navbatida «TT tayyorlash» tugmasini bosing.
2. Shakl kotirovka va mijoz maʼlumotlaridan allaqachon toʻldirilgan: dastur, til (RU yoki EN), muqova varianti, sugʻurta summasi, sugʻurta mukofotlari, xodimlar soni, sugʻurta davri, taklifning amal qilish muddati (demo: 30 kun), toʻlov shartlari, assistans.
3. Oʻngda — 17 sahifaning oldindan koʻrinishi: muqova, hisob-kitobli taklif xati, dastur broshyurasining 15 sahifasi. Broshyura matnlari kelishilgan va tahrirlanmaydi.
4. «Qoralamani saqlash» yoki «Saqlash va mijozga yuborish». Yuborilgan tijorat taklifi mijozning HR kabinetida paydo boʻladi.
5. «PDF yuklab olish» chop etish oynasini ochadi — «PDF sifatida saqlash» ni tanlang.

<!-- /audience -->

**Mijozning javobi.** HR oʻz kabinetida «Qabul qilish» yoki «Rad etish» (sabab bilan) tugmasini bosadi. Agar mijoz xat bilan javob bergan boʻlsa, menejer qarorni qoʻlda belgilaydi. Agar 5 kundan ortiq javob boʻlmasa (demo), menejerga eslatma keladi. Yuborilgan tijorat taklifini oʻzgartirish uchun «Yangi versiya yaratish» dan foydalaning.

### 5-bosqich. Shartnoma {#contract}

<!-- audience: staff -->

**Kim:** menejer, yurist, anderrayter.

1. Tijorat taklifi qabul qilingandan soʻng bitimda «Shartnomani tayyorlash» tugmasi paydo boʻladi. Shartnoma tijorat taklifidan yaratiladi.
2. Muharrirda chapda — parametrlar: sanalar, dastur, sugʻurta mukofotlari, toʻlovlar jadvali (bir martalik, choraklik yoki oylik), kuchga kirish qoidasi (boshlanish sanasidan yoki birinchi toʻlovdan keyin), ikkala tomonning imzolovchilari, muddat oʻrtasida kiritilgan odamlar uchun sugʻurta mukofotini hisoblash usuli (turi boʻyicha yoki yosh shkalasi boʻyicha).
3. 2-ilova — sugʻurtalanganlar roʻyxati: uni menejer import formatida yoki HR oʻz kabinetida («HRdan soʻrash» vazifasi boʻyicha) yuklaydi. 2-ilovasiz shartnomani kelishuvga yuborib boʻlmaydi.
4. Oʻngda — barcha sahifalarning oldindan koʻrinishi.
5. **Bandni oʻzgartirish.** Har bir bandda «Matnni oʻzgartirish» tugmasi bor. Oʻzgartirilgan band asl matn yonida ajratib koʻrsatiladi va shartnoma **albatta yuristga ketadi**. Yurist maʼqullaydi yoki izoh bilan qaytaradi. Oʻzgarishlar boʻlmasa, yurist bosqichi oʻtkazib yuboriladi.
6. Agar moliyaviy shartlar tasdiqlangan kotirovkadan farq qilsa, ularni anderrayter tasdiqlaydi.
7. «Mijozga yuborish» — shartnoma HR kabinetida paydo boʻladi (ichki maydonlarsiz: yurist izohlari, kotirovka, versiyalar tarixi).
8. Yuborilgan shartnomani oʻzgartirish uchun «Yangi versiya» tugmasini bosing — bunda imzolar bekor qilinadi.

Keyin — imzolash, toʻlov va polisni chiqarish (boʻlim 6).

### Eng kam son va ruxsat etilgan shakllar {#min-group}

<!-- audience: staff -->

«DMS parametrlari»dagi «Mijozlar» guruhi parametrlari (hammasi «demo-qiymat» belgisi bilan):

- **Guruhning eng kam soni** — demo: 10.
- **Eng kam sonda oila aʼzolari** — sukut boʻyicha yoʻq: faqat xodimlar hisoblanadi.
- **Sugʻurtalovchining ruxsat etilgan shakllari** — YaTTdan tashqari hammasi; «MIG qarorini talab qiladi» belgisi.
- **Muddat davomida son eng kam sondan kamaydi** — sukut boʻyicha «xabar berish» (anderrayter va menejerga vazifa); avtomatik bekor qilish yoʻq.

Qayerda tekshiriladi:

1. **Lid:** ruxsat etilmagan shakl saqlanmaydi; eng kam sondan kam son — ogohlantirish.
2. **Baholash uchun maʼlumotlar:** «Xodimlar N / eng kam M» plashkasi; eng kam sondan kam boʻlsa — qizil.
3. **Kotirovka:** eng kam sondan kam boʻlsa, uni vakolat doirasida tasdiqlab boʻlmaydi — faqat «Kelishuvga yuborish». Eng kam sondan istisno vakolatiga ega xodim (demo: anderrayting rahbari) kelishadi va faqat «Nima uchun istisno qilinmoqda» majburiy izohi bilan. Istisno kotirovkada koʻrinadi: kim, qachon va nima uchun.
4. **Shartnoma:** imzolashdan oldin tizim 2-ilovadagi xodimlarni sanaydi. Ular eng kam sondan kam boʻlsa va kotirovkada istisno tasdiqlanmagan boʻlsa, shartnoma tepasida qizil plashka chiqadi va uni imzolab boʻlmaydi.

Chegaralar va shakllarni faqat ekran emas, server ham tekshiradi.

### Keyingi bosqich uchun nima kerak {#stage-checklist}

<!-- audience: staff -->

Bitim kartasida har bir bosqichda «Keyingi bosqich uchun nima kerak» bloki bor: nima talab qilinadi, tayyor yoki yoʻq, kim masʼul va amal tugmasi (boshqa xodim masʼul boʻlsa — «{rol}dan soʻrash», maʼlumotni mijoz bersa — «HRdan soʻrash»).

- **Lid, baholash maʼlumotlari:** baholash uchun maʼlumotlar (menejer).
- **Kotirovka:** kotirovkani hisoblash va tasdiqlash (anderrayter).
- **TT yuborildi:** mijozning TTga javobi (mijoz HR xodimi).
- **TT qabul qilindi:** shartnoma loyihasi (menejer).
- **Shartnoma:** mijoz rekvizitlari (STIR, vakolat asosi), 2-ilova, ikki tomonning imzolovchilari; anderrayter tasdigʻi — faqat shartlar kotirovkadan farq qilsa; yurist kelishuvi — bandlar oʻzgartirilgan boʻlsa (kelishuvga yuborilgandan keyin).
- **Imzolash:** mijoz va MIG imzolari. **Toʻlov kutilmoqda:** birinchi badal.

Majburiy band bajarilmaguncha keyingi bosqichga oʻtib boʻlmaydi: oʻtish tugmasi («Kotirovkani hisoblash», «TTni yuborish», «Kelishuvga yuborish») faol emas, ostida «Yetishmaydi: …» yozilgan. Server ham xuddi shuni tekshiradi.

### HRdan maʼlumot soʻrash {#request-hr}

<!-- audience: staff hr -->

<!-- audience: staff -->
**Kim:** menejer yoki anderrayter. «HRdan soʻrash» tugmasi boʻsh 2-ilovada, baholash maʼlumotlarida, mijoz kartasining «Sugʻurtalanganlar» yorligʻida va bitim roʻyxatida bor.

1. Mijozda HR kabineti allaqachon boʻlsa (u TT yuborilganda ochiladi), izoh yozing va «Soʻrovni yuborish» tugmasini bosing. Javob muddati — «Mijozning MIG soʻroviga javob muddati» parametri (demo: 5 ish kuni); soʻrov «Mening soʻrovlarim»da koʻrinadi.
2. Kabinet hali boʻlmasa, mijozga xat ochiladi: matnni nusxalang, pochtani oching va CSV shablonini ilova qiling. Olingan faylni oʻzingiz yuklang.
3. HR vazifani bajarganda bildirishnoma olasiz (yuqori paneldagi qoʻngʻiroqcha), roʻyxat bandi tayyor boʻladi.
<!-- /audience -->

<!-- audience: hr -->
**Mijoz HR xodimi.** Kabinet bosh sahifasida «MIGdan vazifalar» bloki paydo boʻladi, masalan «… shartnomasi uchun xodimlar roʻyxatini 15.10 gacha yuklang». «Roʻyxatni yuklash» tugmasi faylni shu yerning oʻzida yuklaydi (shablon — «Shablonni yuklab olish»); boshqa vazifalar «Bajarildi» tugmasi bilan belgilanadi. Bajarilgandan keyin vazifa yoʻqoladi, MIG menejeri bildirishnoma oladi.
<!-- /audience -->

## 6. Imzolash, toʻlov va polisni chiqarish {#signing}

<!-- audience: staff hr -->

Shartnoma **ikkala tomonning** imzolari hisobga olinganda imzolangan hisoblanadi — toʻrt usulning istalgani bilan, ularni birga qoʻllash mumkin. Toʻlovdan keyin polis va sertifikatlar avtomatik chiqariladi.

### Imzolashning toʻrt usuli {#signing-methods}

<!-- audience: staff hr -->

| Usul | MIG qanday imzolaydi | Mijoz qanday imzolaydi | Imzo qachon hisobga olinadi |
| --- | --- | --- | --- |
| ERI (E-IMZO) | Imzolovchi portalda: «ERI bilan imzolash» → kalitni tanlash → kalit paroli | HR kabinetda xuddi shu usulda | Imzolangandan keyin darhol |
| EHA (Didox va b.) | «EHA orqali yuborish» → operatorni tanlash | Mijoz EHA operatorida imzolaydi | Operatordan «imzolangan» hodisasi kelganda |
| Qogʻoz | «Ikki nusxada chop etish» → «MIG imzoladi» → sana bilan «Mijozga yuborildi» | Asl nusxani imzolaydi va qaytaradi | MIG xodimi «Mijozning asl nusxasi olindi» deb belgilaganda yoki skanni tekshirganda |
| Skan | Imzolangan hujjat skanini yuklash | HR kabinetda skanni yuklaydi (PDF, JPEG, PNG, 20 MB gacha) | Faqat MIG xodimi «Skan tekshirildi» tugmasini bosgandan keyin |

Muhim:

- MIG nomidan **faqat imzolash huquqiga ega xodim** (imzolovchi) imzolay oladi. Boshqalarga tugma mavjud emas. <!-- audience: staff -->
- Agar tomonlardan aqalli biri qogʻozda yoki skan bilan imzolagan boʻlsa, tizim **asl nusxani** kutadi. «Asl nusxa olindi» belgisisiz 30 kundan soʻng menejerga eslatma keladi. Bu shartnoma ishini bloklamaydi.
- Odatiy kombinatsiya: mijoz skanni hozir, asl nusxani esa keyinroq kuryer orqali yubordi.
- Prototipda ERI va EHA imitatsiya qilinadi. Ishchi tizimda ERI foydalanuvchi kompyuteridagi E-IMZO ilovasi orqali ishlaydi.

### Toʻlov {#payment}

<!-- audience: staff hr -->

1. Imzolangandan keyin tizim toʻlovlar jadvali boʻyicha hisoblarni oʻzi yaratadi. Ularni MIG buxgalteri va mijozning HR xodimi koʻradi.
2. Buxgalter toʻlovni qoʻlda belgilaydi yoki 1C dan koʻchirmani yuklaydi (batafsil — boʻlim 12).
3. Qisman toʻlashga ruxsat beriladi. Muddati oʻtgan badal menejer va buxgalterga eslatma yuboradi.

### Kuchga kirish {#effective-date}

<!-- audience: staff hr -->

Shartnoma oʻz qoidasiga koʻra amalga kiradi: «boshlanish sanasidan» yoki «boshlanish sanasidan, lekin birinchi badal toʻlanishidan oldin emas» (sukut boʻyicha — ikkinchisi). U bilan birga bitim «Faol» holatiga, mijoz esa «Faol mijoz» holatiga oʻtadi.

### Polis va sertifikatlarni chiqarish {#policy-issue}

<!-- audience: staff hr -->

Shartnoma kuchga kirgan paytda tizim avtomatik ravishda:

1. Shartnomaga havola va tanlangan assistans bilan polis yaratadi.
2. 2-ilovadan sugʻurtalanganlarni yaratadi — har bir xodim va har bir oila aʼzosini alohida.
3. Har biriga sertifikat raqamini beradi va sertifikatni shakllantiradi.
4. Sugʻurtalanganlarga ilovaga SMS-taklifnomalar yuboradi.
5. Sugʻurtalanganlar roʻyxatini assistansga uzatadi.

HR polisni, odamlar roʻyxatini koʻradi va sertifikatlarni chop etish uchun bittadan yoki hammasini birdaniga yuklab olishi mumkin. Sugʻurtalangan shaxs oʻz sertifikatini ilovada koʻradi: «Profil» → «Mening sertifikatim».

**Polis qoʻlda yaratilmaydi.** Agar eski tizimdagi amaldagi shartnomani tizimga kiritish kerak boʻlsa — portfelni koʻchirishdan foydalaning (boʻlim 16).

## 7. Shartnomaga xizmat koʻrsatish {#servicing}

<!-- audience: staff hr insured -->

Amaldagi shartnomaga har qanday oʻzgarish — yangi xodim, ishdan boʻshash, farzand, dasturni almashtirish — avval oʻzgartirish arizasiga aylanadi, soʻngra qoʻshimcha toʻlov yoki qaytarish hisobi bilan qoʻshimcha kelishuv orqali rasmiylashtiriladi.

### Xodimlarni kiritish va chiqarish {#enrolment}

<!-- audience: staff hr -->

1. **HR** kabinetda: «Xodimlar» → «+ Xodim qoʻshish» (F.I.Sh. lotin yozuvida, tugʻilgan sana, JShShIR, telefon, lavozim, boshlanish sanasi) yoki «CSV dan yuklash» (1 000 qatorgacha, avval xatolar bilan oldindan koʻrish). Ishdan boʻshash uchun — qator menyusi → «Sanadan chiqarish…».
2. HR ning har bir harakati sana bilan **oʻzgartirish arizasini** yaratadi.
3. **Yangi xodim HR arizasi sanasidan himoyalangan** (sukut boʻyicha), qoʻshimcha kelishuv imzolanishini kutmasdan. Chiqarilgan xodim chiqarilgan sanadan qoplamani yoʻqotadi; ilovada u «Polis tugagan» ni koʻradi.
4. Assistans oʻzgarishlarni darhol oʻz sugʻurtalanganlar roʻyxatida koʻradi.

### Shartnoma amal qilayotganda son eng kam sondan kam {#below-min-term}

<!-- audience: staff hr -->

HR xodimni chiqarsa va shundan soʻng sugʻurtalanganlar eng kam sondan kam boʻlib qolsa, tasdiqlashdan oldin «Shartnoma shartlariga koʻra eng kam son — M» ogohlantirishi chiqadi. Chiqarish mumkin: ariza odatdagidek MIGga yuboriladi, anderrayter va menejer esa «Chiqarishdan soʻng son eng kam sondan kam» vazifasini oladi — ular shartnoma shartlari bilan nima qilishni hal qiladi. Avtomatik bekor qilish yoʻq. Agar MIG parametrlarda «Bunday chiqarishni taqiqlash»ni tanlasa, ariza yuborilmaydi va HR tushuntirishni koʻradi.

### Oila aʼzolari {#family}

<!-- audience: staff hr insured -->

Oila aʼzolari — oʻz sertifikati, QR kodi, limitlari, zararlari va qabullariga ega boʻlgan xuddi shunday sugʻurtalangan shaxslar.

- **HR qoʻshadi:** «Oila» → «Oila aʼzosini qoʻshish» (F.I.Sh. lotin yozuvida, tugʻilgan sana, JShShIR, qarindoshlik: turmush oʻrtogʻi, farzandi, ota-onasi, boshqa; qaysi xodimga).
- **Xodim soʻraydi:** ilovada «Mening oilam» → «Qoʻshish» rozilik bilan. Ariza HR ga «Ilovadan arizalar» boʻlimiga boradi. HR maʼqullaydi (bu oʻzgartirish arizasini yaratadi) yoki sabab bilan rad etadi.
- **Bolaning chegaraviy yoshi** — 18 yosh, talabalar uchun — 23 yosh («ITS parametrlari» dagi demo qiymatlar). Bola unga yetganda anderrayter vazifa oladi; hech kim avtomatik chiqarilmaydi.
- **Oila ichidagi maxfiylik:** xodim oʻz farzandlari boʻyicha hamma narsani koʻradi. Voyaga yetgan oila aʼzosi boʻyicha — faqat sugʻurta faktini, sertifikat va QR ni, toki u oʻz ilovasida «… mening murojaatlarimni koʻrishiga ruxsat berish» ni yoqmaguncha. Ruxsatni qaytarib olish mumkin.
- **Limitlar** har kimning oʻziniki (sukut boʻyicha rejim) yoki oila uchun umumiy — sozlama «ITS parametrlari» da.

### Qoʻshimcha kelishuv {#endorsement}

<!-- audience: staff -->

**Kim:** sotuv menejeri, summalarni anderrayter tasdiqlaydi.

1. Arizalar «Tarkibdagi oʻzgarishlar» / «Qoʻshimcha kelishuvlar» boʻlimida toʻplanadi. Sukut boʻyicha qoʻshimcha kelishuv barcha arizalar boʻyicha **oyiga bir marta** rasmiylashtiriladi («Har bir oʻzgarish uchun» deb sozlash mumkin).
2. Tizim har bir qatorni hisoblaydi va formulani koʻrsatadi:
   - «turi boʻyicha» shartnomada **kiritish**: xodim (yoki oila aʼzosi) uchun sugʻurta mukofoti × qolgan kunlar ÷ muddat kunlari.
   - «yosh shkalasi boʻyicha» shartnomada **kiritish**: shartnomaning stavkalar jadvalidan kiritilgan sanadagi inson yosh guruhining stavkasi × qolgan kunlar ÷ muddat kunlari.
   - **Chiqarish:** parametrlardagi qoida boʻyicha qaytarish — qolgan kunlarga mutanosib, ushbu inson boʻyicha toʻlovlarni chegirgan holda mutanosib (sukut boʻyicha) yoki qaytarishsiz.
   - **Dasturni almashtirish:** qolgan muddat uchun sugʻurta mukofotlari farqi.
3. Musbat yakuniy summa — qoʻshimcha toʻlov, manfiy — qaytarish.
4. Agar qoʻshimcha kelishuvda standart bandlar oʻzgartirilgan boʻlsa — yurist kelishuvi. Imzolash — shartnoma bilan bir xil toʻrt usulda (boʻlim 6). Imzolangandan keyin qoʻshimcha toʻlov uchun hisob yoki qaytarish hujjati yaratiladi.

### Uzaytirish {#renewal}

<!-- audience: staff -->

1. Polis tugashidan 60 kun oldin (parametr) tizim **uzaytirish bitimini** yaratadi va anderrayterga «TTsiz uzaytirish» vazifasini qoʻyadi.
2. Anderrayter mijozning umumlashgan zararlilik darajasini koʻradi («Zararlilik darajasi» sahifasi — faqat agregatlar), yangi kotirovka va tijorat taklifini tayyorlaydi.
3. Keyin — yangi mijozdagidek: tijorat taklifi → shartnoma → imzolash → toʻlov → yangi polis.
4. Agar uzaytirish rasmiylashtirilmasa, tugash kunida polis «Muddati tugagan» holatiga oʻtadi.

### Muddatidan oldin bekor qilish {#termination}

<!-- audience: staff -->

1. Shartnoma kartasida — «Bekor qilish»: sana va sabab.
2. Tizim parametrlardagi qoida boʻyicha qaytarish bilan «bekor qilish» turidagi qoʻshimcha kelishuvni shakllantiradi.
3. Imzolangandan keyin polis yopiladi, sugʻurtalanganlar qoplamani yoʻqotadi, assistans bildirishnoma oladi.

## 8. Tibbiy xizmat koʻrsatish {#medical}

<!-- audience: staff insured clinic assist -->

Sugʻurtalangan shaxs yordamni uch yoʻl bilan oladi: hamkor klinikada shifokor qabuliga yoziladi, qimmat xizmatni kafolat xati boʻyicha oladi yoki oʻzi toʻlab, pulni chek boʻyicha qaytarib oladi.

### Shifokor qabuliga yozilish {#appointment}

<!-- audience: staff insured clinic assist -->

1. **Sugʻurtalangan shaxs:** «Shifokor qabuliga yozilish» → mutaxassislik → boʻsh vaqti bor kun va klinika → «Yozilish». Agar toifa limiti deyarli tugagan boʻlsa, yuqorida ogohlantirish chiqadi. Ilovada qabul kim uchun ekanini tanlash mumkin: oʻzingiz yoki farzandingiz uchun.
2. **Klinika** arizani «Qabullar» boʻlimida koʻradi va javob beradi: «Tasdiqlash», «Boshqa vaqt taklif qilish» yoki sabab bilan «Rad etish».
3. **Sugʻurtalangan shaxs** «Klinika tasdiqladi» ni yoki taklif qilingan vaqtni koʻradi va uni qabul qilishi mumkin.
4. Agar klinika muddatida javob bermasa (demo: 2 soat), ariza sugʻurtalangan shaxsning **assistansiga**, assistanssiz mijozlar uchun esa — MIG kuratoriga eskalatsiya qilinadi.
5. Telefon orqali ham yozilish mumkin: assistans operatori murojaatdan qabul yaratadi.

### Kafolat xati {#guarantee-letter}

<!-- audience: staff clinic assist -->

1. **Klinika** bemorni tekshiradi (QR, kod yoki JShShIR bilan polis) — tashrif ochiladi.
2. Tashrifdan — «Kafolat xatini soʻrash»: narxlar roʻyxatidan xizmat, XKT-10 kodi, narxi, shifokor izohi, ilovalar (yoʻllanma, xulosa). «Qoplashni tekshirish» bloki xizmat qoplanishini darhol aytadi.
3. Soʻrov toʻlovchiga ketadi:
   - sugʻurtalangan shaxsning **assistansi**: agar summa uning vakolatlari doirasida boʻlsa (demo: 10 mln soʻm), assistans shifokori hal qiladi; yuqori boʻlsa — MIGga eskalatsiya qiladi;
   - **MIG ekspert shifokori**: eskalatsiyalarni va assistanssiz mijozlarning xatlarini hal qiladi. Chegaradan yuqori xatlar (demo: 20 mln soʻm) ikki shifokorning maʼqullashini talab qiladi.
4. Qaror: maʼqullash (summa va amal qilish muddati), rad etish (sabab) yoki hujjatlarni soʻrash. Klinika uni «Kafolat xatlari» boʻlimida koʻradi.
5. **Maʼqullangan summa sugʻurtalangan shaxsning limitini darhol band qiladi**: ilova va klinika kamaygan qoldiqni koʻradi.

### Chek boʻyicha qoplash {#receipt-refund}

<!-- audience: staff insured assist -->

1. **Sugʻurtalangan shaxs:** «Chek boʻyicha pulni qaytarish» → chek surati (5 tagacha surat, har biri 10 MB gacha). Tizim suratdan geolokatsiyani oʻzi olib tashlaydi va taniydi: qayerda, summa, sana va fiskal maʼlumotlar.
2. Chekning har bir pozitsiyasi «qaytaramiz», «qaytarmaymiz» (masalan, retseptsiz vitaminlar, kosmetika) yoki «aniqlaymiz» belgisini oladi va «qaytarilishi kutilmoqda» summasi koʻrsatiladi. «Qaytarmaymiz» pozitsiyalari bitta tugma bilan olib tashlanadi.
3. Toifani tanlash («Dori-darmonlar», «Shifokor qabuli», «Tahlillar», «Stomatologiya»), tekshirish va «Yuborish».
4. Qoplashni sugʻurtalangan shaxsning assistansi (agar shartnoma boʻyicha qoplashlarni assistans yuritsa) yoki MIGning zararlar boʻyicha mutaxassisi koʻrib chiqadi.
5. Sugʻurtalangan shaxs holatni qadamlar bilan koʻradi: «Qabul qildik» → «Tekshiryapmiz» → «Tasdiqlangan» → «Pul kartada» yoki sodda tildagi sabab va «Eʼtiroz bildirish» tugmasi bilan «Rad etildi».
6. Pul xodimning kartasiga tushadi; voyaga yetgan oila aʼzosi oʻz kartasini koʻrsatishi mumkin.

### «Qoplanadimi?» — SI tekshiruvi {#coverage-check}

<!-- audience: staff insured clinic assist -->

- **Ilovada:** «Qoplanadimi?» plitkasi → xizmat yoki dorini oʻz soʻzlaringiz bilan yozing («tizza MRT», «Akvadetrim»). Javob: «Ehtimol, qoplanadi», «Kafolat xati kerak — uni klinika soʻraydi», «Dasturingiz boʻyicha qoplanmaydi» yoki «Mutaxassis tekshiruvi kerak», dastur bandi va limit qoldigʻi bilan. «Assistansdan soʻrash» tugmasi savol bilan chatni ochadi.
- **Klinikada:** kafolat xatida va yuborishdan oldin reyestrdagi «Qatorlarni tekshirish» tugmasi.
- **Mutaxassislarda:** zarar va kafolat xati kartasidagi «SI maslahati» bloki; assistans hisobidagi «SI dastlabki tekshiruvi».
- **Muhim:** qoplamani dastur qoidalari belgilaydi. SI faqat ifodani taniydi va javobni tushuntiradi. Ilovadagi javob — dastlabki; **rad etishni har doim inson qabul qiladi**. Mutaxassislar «Roziman» yoki «Rozi emasman» deb belgilaydi — aniqlik shunday oʻlchanadi. Administrator SI ni hamma joyda bir zumda oʻchirishi mumkin.

## 9. Klinikalar va reyestrlar {#clinics}

<!-- audience: staff clinic assist -->

Klinika oyiga bitta reyestr yuboradi; tizim uni toʻlovchilar boʻyicha oʻzi ajratadi, har bir toʻlovchi oʻz qatorlarini tekshiradi va toʻlaydi, klinika esa har bir qatorning holatini koʻradi.

### Bemorni tekshirish — klinikaning har qanday ishi shundan boshlanadi {#patient-check}

<!-- audience: staff clinic -->

Klinika sugʻurtalanganlar bazasidan **qidira olmaydi**. U inson haqidagi maʼlumotlarni faqat uning polisini tekshirgandan keyin oladi:

1. Klinika kabinetining bosh sahifasida «Bemorni tekshirish».
2. Usullardan biri:
   - **kamera** — «Kamera bilan skanerlash» va bemor ilovasidagi QR ga yoʻnaltirish;
   - registraturadagi **shtrix-kod skaneri** — QR ni shunchaki skanerlash, maydon allaqachon fokusda;
   - **qoʻlda** — ilovadagi QR ostidagi 8 belgili qisqa kod yoki polis raqami va JShShIR.
3. Natija: F.I.Sh. va tugʻilgan yili (hujjat bilan solishtirish uchun), dastur, polis raqami va muddati, va xizmatlarning har bir toifasi boʻyicha — «qoplanadi», «kafolat xati kerak» yoki «qoplanmaydi», hamda limit holati: «mavjud», «tugayapti», «tugagan». **Limit summalari va murojaatlar tarixi klinikaga koʻrsatilmaydi.**
4. **24 soatlik tashrif** ochiladi — faqat u bilan kafolat xatini soʻrash yoki xizmatlarni reyestrga kiritish mumkin.

Ilovadagi QR bir martalik va har 60 soniyada yangilanadi. Agar bemor eski ekran suratini koʻrsatsa, tizim «Kod eskirgan» deb javob beradi — kartani yangilashni soʻrang. Polis va JShShIR boʻyicha tekshiruvlar cheklangan (foydalanuvchiga soatiga 30 tadan koʻp emas, ketma-ket 10 ta muvaffaqiyatsiz tekshiruvdan keyin — 15 daqiqalik tanaffus).

### Oylik reyestr {#monthly-registry}

<!-- audience: staff clinic assist -->

**Kim:** klinika administratori.

1. «Reyestrlar» → joriy oy reyestri. Uni ikki usulda toʻldirish mumkin: oy tashriflaridan yigʻish yoki shablon boʻyicha CSV yuklash (5 000 qatorgacha, 5 MB gacha).
2. Reyestr qatori: bemor, sana, xizmat kodi va nomi, XKT-10, miqdori, narxi, summasi, kafolat xati raqami (agar xizmat uni talab qilsa).
3. Yuborishdan oldin tizim tekshiradi: narx toʻlovchi bilan shartnomadagi narxlar roʻyxatidan yuqori emas, kafolat xati raqami kerakli joyda koʻrsatilgan, xizmat sanasi polis muddati ichida. «Qatorlarni tekshirish» tugmasi rad etilishi ehtimoli yuqori qatorlarni ajratib koʻrsatadi.
4. «Yuborish». Tizim reyestrni toʻlovchilar boʻyicha **quyi reyestrlarga** ajratadi: har bir qator xizmat sanasida bemor polisi biriktirilgan assistansga ketadi, assistans boʻlmasa — MIGga.
5. Toʻlovchi qatorlarni tekshiradi: «qabul qilingan» yoki sabab bilan «rad etilgan». Qabul qilingan qator bemor limitini yakuniy hisobdan chiqaradi va kafolat xati zaxirasini olib tashlaydi.
6. Klinika rad etilgan qatorga izoh bilan **eʼtiroz bildirishi** mumkin; toʻlovchi javob beradi.
7. Toʻlovni toʻlovchi (assistans yoki MIG buxgalteri) sana va toʻlov topshiriqnomasi raqami bilan belgilaydi. Klinika «… assistansi tomonidan toʻlandi» yoki «MIG tomonidan toʻlandi» ni koʻradi.
8. Reyestr yakunlari — maʼlum qilingan, qabul qilingan, rad etilgan, toʻlangan. Solishtirma dalolatnoma CSV da yuklab olinadi.

### Klinika narxlar roʻyxatlari va shartnomalari {#clinic-prices}

<!-- audience: staff clinic -->

Klinikada turli toʻlovchilar uchun turli narxlar roʻyxati boʻlishi mumkin (MIG uchun va har bir assistans uchun). Qator narxi oʻz toʻlovchisining narxlar roʻyxati boʻyicha tekshiriladi. Narxlar roʻyxatlari va shartnomalar klinika kabinetining «Hujjatlar» boʻlimida koʻrinadi.

### Klinika tizimini ulash (TAT) {#clinic-mis}

<!-- audience: staff clinic -->

Oʻz tibbiy tizimiga ega klinikalar API orqali ishlashi mumkin: bemorlarni tekshirish, jadvalni uzatish, qabullarga javob berish, kafolat xatlarini soʻrash va reyestrlarni avtomatik yuborish. Sozlash — boʻlim 15 da, «Integratsiyalar».

## 10. Assistans: xizmat koʻrsatish, MIG hisoblari, sifat nazorati {#assistance}

<!-- audience: staff assist -->

Assistans oʻziga biriktirilgan mijozlarning sugʻurtalanganlariga xizmat koʻrsatadi, klinikalarga oʻzi toʻlaydi va oyiga bir marta MIGga qoplash uchun hisob chiqaradi; MIG hisobni tekshiradi, toʻlaydi va qarorlar sifatini tanlab nazorat qiladi.

### Mijozlarni biriktirish {#assistance-assignment}

<!-- audience: staff assist -->

- Har bir polis bitta assistansga biriktirilgan yoki hech kimga biriktirilmagan (unda mijozga MIG oʻzi xizmat koʻrsatadi).
- Assistansni **anderrayter** tayinlaydi — tijorat taklifini tayyorlashda yoki mijoz/polis kartasida, boshlanish sanasi bilan.
- Assistans almashganda shu sanadan yangi murojaatlar yangisiga ketadi, avvalgisi esa yana 12 oy davomida oʻzining eski ishlarini **faqat oʻqish uchun** koʻradi (nizolar va solishtirishlar uchun).
- Assistans faqat hodisa sanasidagi oʻz mijozlarining sugʻurtalanganlarini koʻradi. Sugʻurtalangan shaxs ilovada «Qoʻngʻiroq qilish» tugmasi bilan «Sizning assistansingiz 24/7» kartasini koʻradi, ilovadagi chat esa assistans operatorlariga ketadi.

### Assistansning kundalik ishi {#assistance-daily}

<!-- audience: staff assist -->

- **Murojaatlar (qoʻngʻiroqlar markazi):** operator sugʻurtalangan shaxsni qidiruv orqali topadi (F.I.Sh., polis, telefon), kerakli turdagi murojaatni yaratadi — qabul, maslahat, kafolat xati, shikoyat, shoshilinch holat — va uni muddat nazorati bilan hal boʻlguncha olib boradi.
- Vaqtida javob bermagan klinikalardan **qabullar va eskalatsiyalar**.
- **Kafolat xatlari:** assistans shifokori shartnomadagi vakolatlar doirasida hal qiladi; yuqori boʻlsa — oʻz xulosasi bilan «MIGga yuborish».
- **Klinikalarning quyi reyestrlari:** qatorlarni tekshirish, eʼtirozlarga javob berish, klinikalarga toʻlovni belgilash.
- Sugʻurtalanganlarning assistans ustidan shikoyatlari MIG kuratoriga ham koʻrinadi.

### Assistansning MIGga hisobi (qayta hisob chiqarish) {#assistance-rebill}

<!-- audience: staff assist -->

1. **Assistans moliyachisi** oyiga bir marta **shu oyda klinikalarga toʻlangan** qatorlardan hisob shakllantiradi. Tizim shartnoma modeli boʻyicha mukofot pulini qoʻshadi va formulani koʻrsatadi: PEPM — bir oyda sugʻurtalangan shaxs uchun summa; toʻlovlardan foiz; murojaat uchun summa.
2. Yuborilgandan keyin tizim **har bir qatorni avtomatik tekshiradi** va tushuntirish bilan belgilar qoʻyadi: qator klinikaga toʻlanmagan; xizmat sanasida polis amalda boʻlmagan; sugʻurtalangan shaxs ushbu assistansga biriktirilmagan; limit yoki kafolat xati summasi oshib ketgan; dublikat (shu jumladan boshqa assistans hisobida); narx narxlar roʻyxatiga mos emas. «SI dastlabki tekshiruvi» «SI rozi emas» belgisini qoʻshadi.
3. **MIGning zararlar boʻyicha mutaxassisi** qatorlarni sabab bilan qabul qiladi yoki rad etadi; assistans rad etishga eʼtiroz bildirishi mumkin.
4. **MIG buxgalteri** qabul qilingan summani toʻlaydi. Toʻrt koʻz qoidasi: hisobni qabul qilgan xodim uni toʻlay olmaydi.
5. Qabul qilingan hisob qatorlari MIG zararlariga aylanadi va mijozlarning zararlilik darajasiga kiradi.

### Sifat nazorati {#assistance-qa}

<!-- audience: staff -->

Har oy tizim assistans qarorlarining 5% ini (kafolat xatlari va reyestrlarning qabul qilingan qatorlari) MIG ekspert shifokori navbatiga tasodifiy tanlaydi. U izoh bilan «Roziman» yoki «Rozi emasman» deb belgilaydi. Natijalar javob tezligi, muddatida qabul qilingan qarorlar ulushi, shikoyatlar soni va portfelning zararlilik darajasi bilan birga assistans KPI siga kiradi. Tanlov allaqachon toʻlangan qarorlarni oʻzgartirmaydi, lekin tafovutlar assistans kartasida koʻrinadi.

### MIG assistanslarni qayerda koʻradi {#assistance-in-mig}

<!-- audience: staff -->

«Hamkorlar» → «Assistanslar»: sugʻurtalanganlar soni, KPI, tekshiriladigan hisoblar va muddat buzilishlari bilan roʻyxat. Assistans kartasi: umumiy koʻrinish va KPI, shartnoma (mukofot puli, vakolatlar), mijozlar, foydalanuvchilar, integratsiya, hisoblar, sifat nazorati, audit.

## 11. Zararlarni tartibga solish {#claims}

<!-- audience: staff -->

Zarar boʻyicha qarorni zararlar boʻyicha mutaxassis (Claims Officer) oʻz vakolatlari doirasida shartnoma bandiga havola bilan qabul qiladi; ekspert shifokor tibbiy xulosa beradi, lekin qaror emas.

### Zararlar qayerdan keladi {#claims-sources}

<!-- audience: staff -->

| Manba | Qanday paydo boʻladi |
| --- | --- |
| Ilovadan chek | Sugʻurtalangan shaxs «Chek boʻyicha pulni qaytarish» ni yubordi |
| Klinika hisobi | Klinika reyestrining qatori (assistanssiz mijozlar uchun) |
| Assistans hisobi | Qabul qilingan assistans hisobining qatorlari |
| Qoʻngʻiroq, HR xati, email | Mutaxassis qoʻlda roʻyxatga oladi: «+ Yaratish» → «Zarar» yoki sugʻurtalangan shaxs kartasida «+ Zarar» |

Qoʻlda roʻyxatga olishda sugʻurtalangan shaxsni (qidiruv), hodisa sanasini, toifani, summani, manbani va ilovalarni koʻrsating. Zaxira darhol maʼlum qilingan summaga teng qilib belgilanadi.

### Ish joyi {#claims-workplace}

<!-- audience: staff -->

«Tartibga solish» → «Zararlar», varaqlar: «Yangilar», «Koʻrib chiqilmoqda», «Shifokor xulosasini kutmoqda», «Vakolatlarimdan yuqori», «Eʼtirozlar», «Assistans hisoblari qatorlari». Jadvalda raqam, sugʻurtalangan shaxs, mijoz, manba, summa, zaxira, muddat va firibgarlik belgilari koʻrinadi.

### Qarorni qanday qabul qilish kerak {#claims-decision}

<!-- audience: staff -->

1. Zararni oching. Ilovalarni, chekning fiskal maʼlumotlarini, limit qoldigʻini va «SI maslahati» blokini tekshiring.
2. Zarur boʻlsa — «Shifokor xulosasini soʻrash». Ekspert shifokor xulosa va tavsiya yozadi.
3. Qaror: **toʻliq maʼqullash**, **qisman maʼqullash** (summani koʻrsatish) yoki **rad etish**. Qisman maʼqullash va rad etish uchun shartnoma yoki dastur **bandiga havola** va sabab matni **majburiy** — ularsiz qaror saqlanmaydi.
4. Agar qaror summasi shaxsiy vakolatlaringizdan yuqori boʻlsa, u kattaroq vakolatlarga ega hamkasbga kelishishga ketadi. Rad etishda butun maʼlum qilingan summa hisobga olinadi: yirik zarar boʻyicha rad etish ham yuqori vakolatlarni talab qiladi.
5. Qarordan keyin tizim sugʻurtalangan shaxsga xat shakllantiradi. Ilovada u sodda tildagi sababni va «Eʼtiroz bildirish» tugmasini koʻradi.

### Eʼtirozlar {#claims-appeals}

<!-- audience: staff -->

Sugʻurtalangan shaxs yoki klinika qarorga eʼtiroz bildiradi — shu jumladan assistans qaroriga. Eʼtiroz «Eʼtirozlar» varagʻida paydo boʻladi. Ishni qayta koʻrib chiqing, zarur boʻlsa shifokor xulosasini soʻrang va qarorni kuchda qoldiring yoki oʻzgartiring — bu ham bandga havola bilan.

### Zaxiralar {#claims-reserves}

<!-- audience: staff -->

- Har bir ochiq zararning zaxirasi bor: yaratilganda — maʼlum qilingan summa yoki maʼqullangan kafolat xati summasi; qaror qabul qilinganda oʻzgaradi; toʻlov, rad etish yoki yopishda nolga tushadi.
- Zaxirani qoʻlda faqat zararlar boʻyicha mutaxassis sabab koʻrsatgan holda oʻzgartiradi. Oʻzgarishlarning butun tarixi muallif bilan koʻrinadi.
- «Zaxiralar» hisoboti tanlangan sanaga maʼlum qilingan, lekin tartibga solinmagan zararlar zaxirasini mijozlar, assistanslar va toifalar boʻyicha CSV ga yuklash imkoniyati bilan koʻrsatadi. Maʼlum qilinmagan zararlar zaxirasini (IBNR) aktuariy tizimdan tashqarida hisoblaydi.

### Firibgarlik belgilari {#claims-fraud}

<!-- audience: staff -->

Tizim belgilar qoʻyadi, lekin **avtomatik rad etmaydi**:

- **takroriy chek** — fiskal raqam istalgan sugʻurtalangan shaxsning cheki bilan mos keladi, raqam boʻlmasa — summa, sana va savdo nuqtasi; suratning mosligi — qoʻshimcha belgi;
- oyiga juda koʻp murojaat (chegara parametrlarda);
- xizmat sanasi qoplama boshlanishidan oldin yoki chiqarilgandan keyin;
- chiqarilishdan oldingi oxirgi kunlardagi murojaatlar;
- summa narxlar roʻyxatidan sezilarli darajada yuqori.

Belgini faqat izoh bilan olib tashlash mumkin — bu auditga tushadi.

### Zararlar jurnali {#claims-journal}

<!-- audience: staff -->

«Hisobotlar» → zararlar jurnali: hisobot uchun CSV ga yuklash, JShShIR va telefonlarsiz.

## 12. Moliya: hisoblar, toʻlovlar, 1C koʻchirmasi {#finance}

<!-- audience: staff -->

Mijozlarga hisoblar shartnoma va qoʻshimcha kelishuvlarning toʻlovlar jadvali boʻyicha avtomatik yaratiladi; toʻlovlarni buxgalter qoʻlda kiritadi yoki 1C koʻchirmasi bilan yuklaydi, noaniq toʻlovlarni esa «Qoʻlda taqsimlash» navbatida taqsimlaydi.

### Hisoblar {#invoices}

<!-- audience: staff -->

- **Mijozlarga:** shartnoma jadvali boʻyicha (bir martalik, choraklik, oylik) va qoʻshimcha toʻlovli qoʻshimcha kelishuvlar boʻyicha. MIG buxgalteri va mijozning HR xodimiga koʻrinadi.
- **Assistanslarning MIGga hisoblari:** boʻlim 10 ga qarang.
- **Klinikalar hisoblari** (assistanssiz mijozlar uchun): reyestrlarning qabul qilingan qatorlari, ularni MIG buxgalteri toʻlaydi.

Mijozning muddati oʻtgan badali ajratib koʻrsatiladi, menejer va buxgalter eslatma oladi. Muddat oʻtganda xizmat koʻrsatishni bloklashni parametr bilan yoqish mumkin (sukut boʻyicha oʻchirilgan).

### Toʻlovni qoʻlda kiritish {#manual-payment}

<!-- audience: staff -->

«Moliya» → «Hisoblar va toʻlovlar» → hisob → «Toʻlovni belgilash»: sana, summa, toʻlov topshiriqnomasi raqami. Qisman toʻlashga ruxsat beriladi.

### 1C dan koʻchirmani yuklash {#statement-1c}

<!-- audience: staff -->

1. «Hisoblar va toʻlovlar» → «1C dan koʻchirmani yuklash». Majburiy ustunlar: toʻlov hujjati raqami (`doc_number`), sana, summa, toʻlovchining STIR i, toʻlov maqsadi.
2. Tizim toʻlovni **oʻzi taqsimlaydi**, faqat aynan bitta hisob mos kelsa:
   - avval toʻlov maqsadida hisob raqamini qidiradi;
   - soʻngra — toʻlanmagan hisoblar orasida toʻlovchining STIR i va qoldiqning aniq summasini;
   - hisob raqami boʻyicha kamroq summaga toʻlov qisman toʻlov sifatida hisobga olinadi.
3. Qolgan hammasi **«Qoʻlda taqsimlash»** navbatiga ketadi:
   - bir nechta hisob mos keladi;
   - summa birorta hisob bilan mos kelmadi yoki qoldiqdan katta;
   - nomaʼlum STIR;
   - **uchinchi shaxs tomonidan toʻlov** (boshqa STIR) — hisob raqami toʻgʻri boʻlsa ham avtomatik taqsimlanmaydi.
4. **Xuddi shu koʻchirmani qayta yuklash xavfsiz:** hujjat raqami, sanasi, summasi va STIR i bir xil boʻlgan qator oʻtkazib yuboriladi. Yuklangandan keyin «N ta yuklandi, M ta takror sifatida oʻtkazib yuborildi» koʻrinadi.

### Qoʻlda taqsimlash {#manual-allocation}

<!-- audience: staff -->

1. «Moliya» → «Qoʻlda taqsimlash». Har bir toʻlovda mos kelish sababi bilan mos hisoblar boʻyicha maslahatlar bor.
2. Hisobni tanlang yoki toʻlovni bir nechta hisobga boʻling. Taqsimlanmagan qoldiq navbatda qoladi.
3. Boshqa STIR dan kelgan toʻlov uchun (masalan, guruhning boshqa kompaniyasi toʻlagan) **izoh majburiy** — u toʻlovda va audit jurnalida saqlanadi.

## 13. MIG rollari uchun qoʻllanmalar {#staff-roles}

<!-- audience: staff -->

Har bir rolning oʻz ish stoli bor: yuqorida koʻrsatkichlar, turlar boʻyicha varaqlarga ega vazifalar navbati va «Eʼtibor talab qiladi» bloki. Kunni navbatdan boshlang — unda aynan sizni kutayotgan hamma narsa bor.

### Sotuv menejeri {#role-sales}

<!-- audience: staff -->

- **Navbat:** faolliksiz lidlar, 5 kundan ortiq javobsiz tijorat takliflari, imzolanayotgan shartnomalar, olinmagan asl nusxalar, muddati oʻtgan badallar.
- **Har kuni:** «Bitimlar» doskasi boʻyicha bitimlarni yuritish; baholash uchun maʼlumotlarni yuklash; tasdiqlangan kotirovkalar boʻyicha tijorat takliflarini yuborish; qabul qilingan takliflardan shartnomalar tayyorlash; imzolash va toʻlovni kuzatish; oyiga bir marta toʻplangan arizalardan qoʻshimcha kelishuv shakllantirish.
- **Yaratadi:** mijoz (lid), bitim, tarkibdagi oʻzgarish.
- **Mumkin emas:** narxni tasdiqlash; imzolash huquqisiz MIG nomidan imzolash.

### Anderrayter {#role-underwriter}

<!-- audience: staff -->

- **Navbat:** sizning kelishuvingizdagi kotirovkalar va qoralamalaringiz; yaqin 60 kun ichidagi tijorat taklifisiz uzaytirishlar; moliyaviy farqlarga ega shartnomalar va qoʻshimcha kelishuvlar; limitlarni oʻzgartirish soʻrovlari; zararlilik darajasi 80% dan yuqori mijozlar; chegaraviy yoshga yetgan bolalar.
- **Har kuni:** kotirovkalarni hisoblash (chegirma vakolatlaringizdan yuqori boʻlsa — kelishishga yuborish); moliyaviy shartlarni tasdiqlash; limit oʻzgarishlarini tasdiqlash (oʻzingiznikidan tashqari); assistanslarni tayinlash; umumlashgan zararlilik darajasi boʻyicha uzaytirish uchun tijorat takliflarini tayyorlash.
- **Koʻradi:** mijozning zararlilik darajasi boʻyicha — faqat agregatlar (summalar, toifalar, oylar), alohida zararlar va ismlarsiz.

### Yurist {#role-legal}

<!-- audience: staff -->

- **Navbat:** oʻzgartirilgan bandli shartnomalar va qoʻshimcha kelishuvlar, tekshiruvdagi imzolar skanlari.
- **Qanday ishlash kerak:** shartnoma muharririda oʻzgartirilgan bandlar asl matn yonida ajratib koʻrsatilgan. Izoh bilan «Maʼqullash» yoki «Qaytarish». Skanlarni imzolar va muhrlar boʻyicha tekshiring va «Skan tekshirildi» deb belgilang.

### ITS kuratori {#role-curator}

<!-- audience: staff -->

- **Navbat:** assistanslar tomonidan muddatlarning buzilishi, shikoyatlar, assistanssiz mijozlarning javobsiz qabullari.
- **Har kuni:** assistanslar KPI sini kuzatish, sugʻurtalanganlarning shikoyatlarini koʻrib chiqish, assistanssiz mijozlarning qabullarini yuritish, zarur boʻlsa sabab bilan shaxsga doir maʼlumotlarni ochish.

### Zararlar boʻyicha mutaxassis (Claims Officer) {#role-claims-officer}

<!-- audience: staff -->

- **Navbat:** yangi zararlar, vakolatlaringizdan yuqori zararlar, eʼtirozlar, firibgarlik belgilari, assistans hisoblari qatorlari.
- **Har kuni:** xat yoki qoʻngʻiroq bilan maʼlum qilingan zararlarni roʻyxatga olish; bandga havola bilan qarorlar qabul qilish; shifokor xulosalarini soʻrash; zaxiralarni yuritish; belgilarni koʻrib chiqish; assistans hisoblarini tekshirish.
- **Batafsil:** boʻlim 11.

### Ekspert shifokor {#role-doctor-expert}

<!-- audience: staff -->

- **Navbat:** assistanslardan kafolat xatlari eskalatsiyalari va assistanssiz mijozlarning xatlari; soʻralgan xulosalar; nazorat tanlovi.
- **Tibbiy karta:** «Tibbiy kartani ochish» → sabab → taymer bilan 15 daqiqaga kirish. Har bir ochilish auditda.
- **Chegaradan yuqori kafolat xatlari** ikkinchi shifokorni talab qiladi.

### Buxgalter {#role-accountant}

<!-- audience: staff -->

- **Navbat:** qoʻlda taqsimlash, toʻlanadigan assistans hisoblari, muddati oʻtgan badallar, toʻlovlar.
- **Har kuni:** 1C koʻchirmalarini yuklash, toʻlovlarni taqsimlash, assistanslar va klinikalarning qabul qilingan hisoblarini toʻlash, qoplashlar boʻyicha toʻlovlarni belgilash. Batafsil — boʻlim 12.

### MIG administratori {#role-admin}

<!-- audience: staff -->

- **Navbat:** tasdiqlash uchun parametrlar va vakolatlar oʻzgarishlari, integratsiya xatolari.
- **Batafsil:** boʻlimlar 15 va 16.

## 14. HR, sugʻurtalanganlar, klinikalar va assistanslar uchun qoʻllanmalar {#portal-guides}

<!-- audience: all -->

Ushbu boʻlimni hamkorlar va mijozlarga alohida berish mumkin: unda faqat ular oʻz portallarida koʻradigan narsalar bor.

### Mijoz kompaniya HR xodimi {#guide-hr}

<!-- audience: staff hr -->

- **«Xodimlar»:** sugʻurtalanganlar roʻyxati, ilova holati («Foydalanmoqda», «Taklif qilingan», «Taklif qilinmagan»), «Ilovada emas» va «Yaqinda qoʻshilganlar» filtrlari. «+ Xodim qoʻshish», «CSV dan yuklash» (avval shablonni yuklab oling), «Hammaga eslatish» tugmalari — ilovani oʻrnatmaganlarga takroriy taklif.
- **«Oila»:** xodimlarning oila aʼzolari, qoʻshish, «Ilovadan arizalar» — maʼqullash yoki sabab bilan rad etish.
- **Xodimni chiqarish:** qator menyusi → «Sanadan chiqarish…».
- **Tijorat takliflari va shartnomalar:** ochish, taklifni «Qabul qilish» / «Rad etish»; shartnoma va qoʻshimcha kelishuvni ERI bilan imzolash yoki skanni yuklash.
- **«Hisoblar va hujjatlar»:** toʻlanadigan hisoblar, polis hujjatlari, xodimlarning sertifikatlari (bittadan yoki hammasi birdaniga).
- **«Statistika»:** qancha kishi sugʻurtalangan, qanchasi ilovadan foydalanadi, murojaatlarning umumiy soni, byudjetdan foydalanish. 10 kishidan kam guruhlar koʻrsatilmaydi.
- **Muhim:** siz kim sugʻurtalanganini koʻrasiz, lekin **xodimlarning tashxislari, tashriflari va qoplashlarini koʻrmaysiz** — bu tibbiy sir.

### Sugʻurtalangan shaxs (ilova) {#guide-insured}

<!-- audience: staff insured -->

- **Asosiy sahifa:** polis kartasi, «Shifokor qabuliga yozilish», «Chek boʻyicha pulni qaytarish», «Yaqin klinikalar», «Bizga yozing», «Qoplanadimi?» plitkalari; oxirgi qoplash; limitlar boʻyicha «Qancha qoldi»; «Sizning assistansingiz 24/7» kartasi.
- Yuqoridagi **«Men / {ism}» almashtirgichi**: ekrandagi hamma narsa tanlangan oila aʼzosi uchun koʻrsatiladi.
- **«Klinika uchun karta»:** registratura uchun QR va qisqa kod. Kod har daqiqada yangilanadi — ekran suratini emas, jonli ekranni koʻrsating.
- **Qoplashlar:** chekni yuborish, holatlar, rad etilganda «Eʼtiroz bildirish».
- **«Mening oilam»:** oila aʼzosini qoʻshish (ariza HR ga ketadi).
- **Profil:** sertifikat, til, toʻlovlar uchun karta, maʼlumotlarni qayta ishlashga rozilik, «Chiqish».
- **Voyaga yetgan oila aʼzosi** oʻz telefoni bilan kiradi va «{ism} mening murojaatlarimni koʻrishiga ruxsat berish» ni yoqishi yoki uni qaytarib olishi mumkin.

### Klinika {#guide-clinic}

<!-- audience: staff clinic -->

- **Registrator:** «Bemorni tekshirish» → tashrif; «Qabullar» — tasdiqlash, vaqt taklif qilish, rad etish; «Kafolat xatlari» — tashrifdan soʻrov, soʻrov boʻyicha hujjatlarni qoʻshimcha yuklash.
- **Klinika administratori:** xuddi shu, qoʻshimcha ravishda «Reyestrlar» (boʻlim 9), «Hujjatlar» (shartnoma, narxlar roʻyxati, solishtirma dalolatnomalar), «Foydalanuvchilar» (taklif qilish, rolni almashtirish, faolsizlantirish — oʻzingizni faolsizlantirib boʻlmaydi), «Integratsiya» (boʻlim 15).
- **Esda tuting:** polisni tekshirmasdan bemor maʼlumotlari mavjud emas; QR bir martalik.

### Assistans {#guide-assistance}

<!-- audience: staff assist -->

- **Operator:** «Murojaatlar» — qoʻngʻiroqdan yaratish, sugʻurtalangan shaxsni topish; «Qabullar» — klinikalardan eskalatsiyalar; «Chatlar» — ilovadan xabarlar.
- **Shifokor:** «Kafolat xatlari» — vakolatlar doirasida qaror yoki MIGga eskalatsiya; quyi reyestrlar qatorlarini tekshirish; sabab bilan oʻz sugʻurtalanganlarining tibbiy kartasi.
- **Moliyachi:** «Klinikalar reyestrlari» — tekshirish va klinikalarga toʻlovni belgilash; «MIG hisoblari» — oy uchun shakllantirish, yuborish, rad etishlarga javob berish.
- **Administrator:** «Foydalanuvchilar», «Integratsiya».
- **Esda tuting:** siz faqat hodisa sanasidagi oʻz mijozlaringizning sugʻurtalanganlarini koʻrasiz; barcha navbatlarning muddatlari bor, muddat oʻtgani ajratib koʻrsatiladi.

## 15. Maʼmuriyat {#administration}

<!-- audience: staff clinic assist -->

<!-- audience: staff -->
MIG administratori foydalanuvchilar, vakolatlar, parametrlar, hamkorlar va integratsiyalarni boshqaradi; deyarli barcha oʻzgarishlar faqat ikkinchi administrator tasdiqlagandan keyin kuchga kiradi va auditga yoziladi.

### MIG xodimlari {#admin-users}

<!-- audience: staff -->

1. «+ Yaratish» → «Foydalanuvchi» → email, F.I.Sh., rol → «Taklif qilish». Xodim taklifnoma oladi, parol oʻrnatadi va ikkinchi omilni sozlaydi.
2. «Maʼmuriyat» → «Foydalanuvchilar va rollar»: rolni almashtirish (tasdiqlash bilan), ishdan boʻshagan xodimni faolsizlantirish. Administrator rolini oʻzingizdan olib tashlab boʻlmaydi.
3. **Vakolatlar va imzolash huquqi** — xodim profilida: tarifdan eng katta chegirma va kelishuvsiz kotirovka sugʻurta mukofoti (anderrayter), zarar boʻyicha qarorning eng katta summasi (zararlar boʻyicha mutaxassis), asos bilan imzolash huquqi («… dagi …-son ishonchnoma»). Oʻzgarish faqat **ikkinchi administrator** tasdiqlagandan keyin qoʻllanadi; xodimning oʻzi tasdiqlay olmaydi.

### ITS parametrlari {#admin-params}

<!-- audience: staff -->

«Maʼmuriyat» → «ITS parametrlari». Tizimning barcha biznes-qoidalari bir joyda, har bir parametr birlik, tavsif va ruxsat etilgan diapazon bilan. Qiymat oʻzgartirilmagan ekan, yonida «demo qiymat» belgisi turadi. Asosiy guruhlar:

- **muddatlar:** klinikaning qabul arizasiga javobi, assistans hisobi va quyi reyestrni tekshirish, uzaytirish oynasi, tijorat taklifining amal qilish muddati, lidlar, takliflar va asl nusxalar boʻyicha eslatmalar;
- **chegaralar:** «limit tugab bormoqda», kafolat xati uchun ikki shifokor, nazorat tanlovi, firibgarlik belgisi uchun murojaatlar chastotasi;
- **tarif:** dasturlarning bazaviy stavkalari, yosh guruhlari koeffitsiyentlari, guruh hajmi uchun chegirmalar;
- **xizmat koʻrsatish:** qoʻshimcha kelishuvlar davriyligi, chiqarishda qaytarish qoidasi, yangi xodim qaysi sanadan qoplanishi, muddat oʻtganda bloklash;
- **oila aʼzolari:** limitlar rejimi, bolalar va talabalarning chegaraviy yoshi;
- **xavfsizlik:** kirish urinishlari va JShShIR boʻyicha tekshiruvlar limitlari;
- **raqamlash:** hujjat raqamlari shablonlari (faqat lotin harflari, raqamlar, «-» va «/»).

Oʻzgartirish: «Yangi qiymat taklif qilish» → ikkinchi administrator yoki anderrayter tasdiqlaydi → qiymat amal qiladi, auditda «avval — keyin, kim, qachon» yozuvi.

### SI {#admin-ai}

<!-- audience: staff -->

«Maʼmuriyat» → «SI»: toʻrtta stsenariyning har birini yoqish, ishonch chegarasi (demo: 60%), mutaxassislarning maslahatlar bilan rozilik metrikalari, etalon holatlarni sinab koʻrish. **«SI ni hamma joyda oʻchirish»** tugmasi bir zumda ishlaydi; qayta yoqish ikkinchi administratorni talab qiladi.

### Hamkorlar {#admin-partners}

<!-- audience: staff -->

- **Klinika:** «+ Yaratish» → «Klinika»: lotin yozuvidagi nom, shakl, manzil, mutaxassisliklar, shartnoma, ish rejimi (faqat kabinet, API, API va kabinet). Soʻngra klinikaning birinchi administratorini taklif qiling — keyin oʻz xodimlarini klinika oʻzi qoʻshadi.
- **Assistans kompaniyasi:** «+ Yaratish» → «Assistans kompaniyasi»: nom, sugʻurtalanganlar uchun 24/7 telefon, ish rejimi, shartnoma — mukofot puli modeli va miqdori, kafolat xatlari boʻyicha vakolatlar, sugʻurtalanganlarga qoplashlarni yuritadimi, hisobni toʻlash muddati. Assistansning birinchi administratorini taklif qiling.
- **Mijozlarni assistansga biriktirishni** anderrayter amalga oshiradi (boʻlim 10).

### Integratsiyalar {#admin-integrations}

<!-- audience: staff clinic assist -->

Oʻz tizimiga ega klinikalar va assistanslar API orqali ulanadi. Kalitlarni **hamkorning oʻzi** oʻz kabinetining «Integratsiya» boʻlimida chiqaradi:

1. «API kalitlari» → nom, kirish sohalari, xohishga koʻra ruxsat etilgan IP lar → «Yaratish». Maxfiy kalit **bir marta** koʻrsatiladi — uni darhol saqlash kerak.
2. «Vebxuklar» — faqat https manzil, hodisalarni tanlash, «Sinov hodisasini yuborish», qayta yuborish imkoniyatli yetkazib berish jurnali.
3. «Soʻrovlar jurnali», misollar bilan «Hujjatlar», tekshirish uchun «Sinov muhiti».

<!-- audience: staff assist -->
MIG administratori hamkorning integratsiyasini uning kartasida koʻradi (maxfiy qismsiz kalitlar, 24 soatdagi xatolar) va **istalgan kalitni bekor qilishi mumkin** — masalan, sizib chiqish shubhasi boʻlganda.

### Audit jurnali {#admin-audit}

<!-- audience: staff -->

«Maʼmuriyat» → «Audit jurnali»: harakat, xodim, assistans va sanalar boʻyicha filtrlar. Bu yerda barcha kirishlar, shaxsga doir maʼlumotlar va tibbiy kartalarning ochilishi, qarorlar, parametrlar va vakolatlarning oʻzgarishlari, yuklab olishlar, hamkorlar harakatlari koʻrinadi.

### Tillar {#admin-languages}

<!-- audience: staff -->

Interfeys rus, oʻzbek (lotin) va ingliz tillarida mavjud. Atamalar lugʻatda yuritiladi; tarjimalarga tuzatishlar `docs/i18n-review.csv` tekshiruv fayli orqali kiritiladi.

## 16. Amaldagi portfelni koʻchirish {#portfolio-migration}

<!-- audience: staff:admin -->

Eski tizimdagi amaldagi shartnomalar bitimlar orqali emas, «Portfelni koʻchirish» orqali kiritiladi: oltita CSV fayl tartib bilan yuklanadi, har biri avval yozuvsiz tekshiriladi, paketni ikkinchi administrator qoʻllaydi, yuklangandan keyin esa tizim dastlabki yakunlar bilan solishtirishni koʻrsatadi.

**Qayerda:** «Maʼmuriyat» → «Portfelni koʻchirish» (faqat MIG administratori).

### Tayyorlash {#migration-prep}

<!-- audience: staff:admin -->

1. Koʻchirish sahifasida CSV shablonlarini yuklab oling.
2. Maʼlumotlarni eski tizimdan eksport qiling va shablonlarga joylashtiring. Kompaniyalar nomlari va F.I.Sh. — reyestr va ID-kartalardagidek **lotin yozuvida**.
3. Solishtirish uchun yakunlarni tayyorlang: mijozlar, shartnomalar, sugʻurtalanganlar soni, umumiy sugʻurta mukofoti, zaxiralar summasi.

### Olti qadam — qatʼiy tartibda {#migration-steps}

<!-- audience: staff:admin -->

| Qadam | Fayl | Asosiy mazmun |
| --- | --- | --- |
| 1 | Mijozlar | Nom, shakl, STIR, rekvizitlar, HR bilan aloqa |
| 2 | Shartnomalar | Eski MIG raqami, sanalar, dastur, sugʻurta mukofoti, `premium_employee` va `premium_family`, jadval, hisoblash usuli (`pricing_basis`), assistans |
| 3 | Sugʻurtalanganlar | **Har bir inson** uchun qator: F.I.Sh., tugʻilgan sana, JShShIR, eski sertifikat raqami, kiritilgan sana, shartnoma; oila aʼzolari uchun — `relation` va `principal_pinfl` (xodimning JShShIR i); mavjud boʻlsa — alohida sugʻurta mukofoti `premium` |
| 4 | Foydalanilgan limitlar | Koʻchirish sanasiga, toifalar boʻyicha, har bir sugʻurtalangan shaxs boʻyicha |
| 5 | Ochiq zararlar | Holatlar va zaxiralar |
| 6 | Toʻlanmagan hisoblar | Raqam, summa, muddat |

Har bir qadamda:

1. Faylni yuklang — tizim **hech narsa yozmasdan barcha qatorlarni tekshiradi** va hisobot koʻrsatadi: qatorlar va maydonlar boʻyicha xatolar, ogohlantirishlar.
2. Fayldagi xatolarni tuzating va qayta yuklang — yoki qadamni «Xatoli qatorlarni chiqarib tashlash» belgisi bilan tasdiqlang.
3. Keyingi qadamga oʻting.

### Sugʻurtalanganlarning sugʻurta mukofotlari {#migration-premiums}

<!-- audience: staff:admin -->

Har bir insonning sugʻurta mukofoti quyidagi tartibda olinadi: sugʻurtalanganlar faylidagi alohida mukofot → shartnomadan turi boʻyicha (xodim uchun `premium_employee`, oila aʼzosi uchun `premium_family`) → aks holda «Mukofot yoʻq» xatosi. Shartnoma boʻyicha sugʻurtalanganlar mukofotlarining yigʻindisi shartnoma mukofoti bilan 1 soʻm aniqlikda mos kelishi kerak — tafovut tekshiruvdayoq ajratib koʻrsatiladi.

### Qoʻllash va solishtirish {#migration-apply}

<!-- audience: staff:admin -->

1. Tayyor paketni **ikkinchi administrator qoʻllaydi** — paket muallifi buni qila olmaydi.
2. Qoʻllangandan keyin **solishtirishni** oching: mijozlar, shartnomalar, sugʻurtalanganlar, sugʻurta mukofotlari, zaxiralar, limitlar, hisoblar — fayllar yakunlari bilan taqqoslash, tafovutlar ajratib koʻrsatilgan (masalan, chiqarib tashlangan xatoli qatorlar).
3. Koʻchirilgan shartnomalar darhol «Amalda» holatini oladi — tijorat taklifi va kelishuvlarsiz. Eski MIG raqami saqlanadi va qidiruvda topiladi, yangi raqam shablon boʻyicha beriladi. Imzolangan shartnoma skanini keyinroq biriktirish mumkin.
4. Barcha koʻchirilgan yozuvlar sana va paket muallifi bilan «Eski tizimdan koʻchirilgan» deb belgilanadi.
5. Sugʻurtalanganlar ilovada limit qoldigʻini **koʻchirishgacha sarflangan summani hisobga olgan holda** koʻradi.

### Eng kam sondan kam shartnomalar va ruxsat etilmagan shakllar {#migration-group-warnings}

<!-- audience: staff:admin -->

Eng kam sondan kam yoki mijozi ruxsat etilmagan shakldagi koʻchirilgan amaldagi shartnoma odatdagidek yuklanadi — u muddat oxirigacha amal qiladi. Paket hisobotida u boʻyicha ogohlantirish boʻladi, shartnoma va mijoz kartochkalarida esa «Eng kam sondan kam» va «Shakl ruxsat etilmaydi» belgilari. Qoidalar yangi shartnomalarga qoʻllanadi.

### Bekor qilish {#migration-rollback}

<!-- audience: staff:admin -->

Paketni uning maʼlumotlari bilan hech kim ishlamagan ekan, toʻliq bekor qilish mumkin. Agar koʻchirilgan maʼlumotlar boʻyicha harakatlar boʻlgan boʻlsa, bekor qilish nima xalaqit berayotgani tushuntirilgan holda bloklanadi.

### Bitta shartnomani qoʻlda kiritish {#migration-manual}

<!-- audience: staff:admin -->

Yagona shartnoma uchun qoʻlda kiritish bor — CSV qatori bilan bir xil shakl, xuddi shu tekshiruvlar va ikkinchi administrator tasdigʻi bilan.

## 17. Agar… boʻlsa, nima qilish kerak {#troubleshooting}

<!-- audience: all -->

Odatiy vaziyatlar va harakatlar tartibi; agar vaziyat roʻyxatda boʻlmasa, ITS kuratoriga yoki administratorga murojaat qiling.

| Vaziyat | Nima qilish kerak |
| --- | --- |
| **Sugʻurtalangan shaxs kira olmayapti** | Uning kartasidagi telefon raqami toʻgʻriligini va u polisga kiritilganini (chiqarilmaganini) tekshiring. Agar raqamini almashtirgan boʻlsa — HR xodim kartasida telefonni tuzatadi. 5 ta muvaffaqiyatsiz urinishdan keyin kirish 5 daqiqaga bloklanadi — kuting. | <!-- audience: staff hr insured assist -->
| **MIG xodimi kira olmayapti** | Bloklashdan keyin 5 daqiqa kuting. Agar ikkinchi omilga kirish yoʻqolgan boʻlsa — administrator taklifnomani qayta yuboradi. | <!-- audience: staff -->
| **Registraturada «Kod eskirgan»** | Ilovadagi kod 60 soniya amal qiladi va bir martalik. Bemordan «Klinika uchun karta» ni qayta ochishni soʻrang. Telefon boʻlmasa — polis raqami va JShShIR boʻyicha tekshirish. | <!-- audience: staff clinic insured -->
| **Klinika qabulga javob bermayapti** | 2 soatdan keyin (demo) ariza oʻzi assistansga (yoki MIG kuratoriga) ketadi. Operator klinika bilan bogʻlanadi yoki boshqasini taklif qiladi. | <!-- audience: staff clinic assist -->
| **Limit tugagan** | Ilova va klinika «tugagan» ni koʻradi. Keyingi xizmatlar — sugʻurtalangan shaxs hisobidan. Istisno uchun — limitni oʻzgartirish soʻrovi (kurator yoki anderrayter yaratadi, boshqa anderrayter tasdiqlaydi). | <!-- audience: staff clinic assist insured -->
| **Qimmat xizmat kerak** | Klinika tashrifdan kafolat xatini soʻraydi. Kafolat xati talab qiladigan xizmatni u maʼqullanmaguncha koʻrsatmang — kafolat xati raqamisiz reyestr qatori rad etiladi. | <!-- audience: staff clinic assist -->
| **Sugʻurtalangan shaxs rad etish bilan rozi emas** | Ilovada — «Eʼtiroz bildirish». Eʼtiroz zararlar boʻyicha mutaxassisga keladi. | <!-- audience: staff insured assist -->
| **Klinika rad etilgan qator bilan rozi emas** | Reyestrda — izoh bilan «Qatorga eʼtiroz bildirish». Toʻlovchi javob beradi. | <!-- audience: staff clinic assist -->
| **«Takroriy chek» belgisi** | Topilgan moslik bilan solishtiring. Agar bu haqiqatan ham turli xaridlar boʻlsa, belgini izoh bilan olib tashlang; agar takror boʻlsa — bandga havola bilan rad eting. | <!-- audience: staff -->
| **Zarar vakolatlarimdan yuqori** | Shunchaki qaror qabul qiling — tizim uni kattaroq vakolatlarga ega hamkasbga kelishishga oʻzi yuboradi. | <!-- audience: staff -->
| **Shartnoma bandini oʻzgartirish kerak** | Muharrirda — «Matnni oʻzgartirish». Shartnoma yuristga ketadi. Yuborilgan shartnomada — «Yangi versiya» (imzolar bekor qilinadi). | <!-- audience: staff -->
| **Mijoz faqat skan yubordi** | Skanni yuklang, MIG xodimi «Skan tekshirildi» deb belgilaydi. Shartnoma ishlaydi; tizim 30 kundan keyin asl nusxa haqida eslatadi. | <!-- audience: staff hr -->
| **Toʻlov taqsimlanmadi** | «Qoʻlda taqsimlash» ni oching, maslahat boʻyicha hisobni tanlang. Agar boshqa kompaniya toʻlagan boʻlsa — majburiy izoh bilan taqsimlang. | <!-- audience: staff -->
| **Koʻchirma ikki marta yuklandi** | Hech qisi yoʻq: takroriy qatorlar oʻtkazib yuboriladi, summalar ikki baravar oshmaydi. | <!-- audience: staff -->
| **Mijoz xodimi ishdan boʻshadi** | HR: «Sanadan chiqarish…». Sugʻurta mukofotini qaytarish parametrlardagi qoida boʻyicha eng yaqin qoʻshimcha kelishuvda hisoblanadi. | <!-- audience: staff hr -->
| **Xodimning farzandi tugʻildi** | HR «Oila» ga qoʻshadi (yoki xodim ilovadan ariza beradi, HR maʼqullaydi). Bola oʻz sertifikati va QR ini oladi. | <!-- audience: staff hr insured -->
| **Bola chegaraviy yoshga yetdi** | Anderrayter vazifa oladi. HR bilan hal qiling: bolani qoʻshimcha kelishuv orqali chiqarish yoki talabalar uchun qoida boʻyicha sugʻurtani davom ettirish. | <!-- audience: staff hr insured -->
| **Mijoz assistansni almashtiryapti** | Anderrayter polis kartasida assistansni sana bilan almashtiradi. Eski ishlar avvalgi assistansda faqat oʻqish uchun qoladi. | <!-- audience: staff assist -->
| **HR xodimlarning tashxislari yoki cheklarini soʻrayapti** | Rad eting: bu tibbiy sir. HR faqat sugʻurta faktini va shaxssizlashtirilgan statistikani koʻradi. | <!-- audience: staff hr -->
| **MIG xodimi ishdan boʻshadi** | Administrator hisob qaydnomasini shu kuni faolsizlantiradi. Agar u imzolovchi boʻlgan boʻlsa — imzolash huquqini olib tashlang. | <!-- audience: staff -->
| **Hamkorning API kaliti sizib chiqqanlik shubhasi** | MIG administratori hamkor kartasida kalitni darhol bekor qiladi; hamkor yangisini yaratadi. Soʻrovlar jurnalini tekshiring. | <!-- audience: staff clinic assist -->
| **SI gʻalati javoblar beryapti** | Izoh bilan «Rozi emasman» deb belgilang. Ommaviy muammoda administrator «SI ni hamma joyda oʻchirish» tugmasini bosadi — ish maslahatlarsiz davom etadi. | <!-- audience: staff assist -->
| **Klinika yoki 1C bilan integratsiya xatosi** | Administrator ish stolidagi «Integratsiyalar» bloki holat va navbatni koʻrsatadi. Hamkorning soʻrovlar jurnalini tekshiring, u bilan bogʻlaning. | <!-- audience: staff -->
| **YaTT shaklidagi lid saqlanmaydi** | DMS faqat kompaniyalar uchun rasmiylashtiriladi. MIG boshqacha qaror qilsa, administrator «Sugʻurtalovchining ruxsat etilgan shakllari» parametrini oʻzgartiradi (ikkinchi administrator tasdiqlaydi). | <!-- audience: staff -->
| **Kotirovkani tasdiqlab boʻlmaydi: son eng kam sondan kam** | Kelishuvga yuboring. Anderrayting rahbari istisnoni nima uchun asosli ekani haqidagi izoh bilan kelishishi mumkin. | <!-- audience: staff -->
| **Shartnoma imzolanmaydi: eng kam sondan kam** | 2-ilovada xodimlar eng kam sondan kam, kotirovkada istisno tasdiqlanmagan. Toʻliq roʻyxatni yuklang yoki kotirovkada istisnoni kelishing. | <!-- audience: staff -->
| **Chiqarishdan soʻng xodimlar eng kam sondan kam** | HR xodimni chiqarishi mumkin; anderrayter va menejer vazifa oladi va mijoz bilan shartnoma shartlarini hal qiladi. | <!-- audience: staff hr -->
| **Ilovaga kirishda «Kod mos kelmadi yoki bu raqam topilmadi»** | Xabar ataylab nomaʼlum raqam va notoʻgʻri kod uchun bir xil va faqat kod kiritilgandan keyin chiqadi — shunda kim sugʻurtalanganini tanlash yoʻli bilan bilib boʻlmaydi. SMSdagi kodni tekshiring; u toʻgʻri boʻlsa — kompaniyangiz HRiga murojaat qiling, sugʻurtalanganlar roʻyxatidagi raqamni tekshirsin. | <!-- audience: staff hr insured -->
| **Soʻrovga javob berishmayapti** | Ish stolida «Mening soʻrovlarim»ni oching: soʻrov kimga ketgani va ishga olingani koʻrinadi. Muddat oʻtganda «Eslatish»ni bosing — ijrochi takroriy bildirishnoma oladi. Baribir javob boʻlmasa, ijrochi yoki uning rahbari bilan bevosita bogʻlaning; javob muddatini «Ichki soʻrovga javob muddati» va «Mijozning MIG soʻroviga javob muddati» parametrlari belgilaydi. | <!-- audience: staff -->
| **Soʻrov notoʻgʻri odamga kelgan** | Navbat qatorida «Rad etish»ni bosing va kimga murojaat qilish kerakligini yozing — muallif izohni koʻradi va soʻrovni qayta yuborishi mumkin. | <!-- audience: staff -->

## 18. Xavfsizlik va maxfiylik {#security}

<!-- audience: all -->

Tizim shaxsga doir va tibbiy maʼlumotlarni saqlaydi, shuning uchun har bir foydalanuvchi nimani ochishi va kimga berishi uchun javobgar; barcha muhim narsalar audit jurnaliga yoziladi.

### Hamma uchun qoidalar {#security-rules}

<!-- audience: all -->

- Parol va ikkinchi omil kodini hech kimga, hatto hamkasblarga va «IT dan» boʻlganlarga ham bermang. MIG xodimlari ularni hech qachon soʻramaydi.
- Kompyuterdan ketayotganda tizimdan chiqing yoki ekranni bloklang. Seans 15–30 daqiqa faoliyatsizlikdan keyin oʻzi tugaydi.
- Shaxsga doir maʼlumotlar bilan ekran suratlarini olmang va ularni messenjerlarda yubormang.
- CSV ga faqat ish uchun kerakli narsalarni yuklab oling. Yuklab olishlarda JShShIR, telefonlar, tugʻilgan sanalar va tashxislar boʻlmaydi, lekin baribir auditga tushadi.

### Shaxsga doir maʼlumotlar {#security-pii}

<!-- audience: all -->

- JShShIR, telefon, tugʻilgan sana, email va karta raqami **niqoblangan** holda koʻrsatiladi.
- Toʻliq qiymatni koʻrish uchun «Koʻrsatish» tugmasini bosing va sababni koʻrsating (kamida 10 ta belgi; tezkor variantlar bor: «№… zararni koʻrib chiqish», «Sugʻurtalangan shaxsning qoʻngʻirogʻi», «Klinika soʻrovi»). Qiymat 30 soniya koʻrinadi, soʻngra yana yashiriladi. Nusxa olish ham yoziladi. <!-- audience: staff assist -->
- Maʼlumotlarni faqat ularsiz vazifani bajarib boʻlmaganda oching. <!-- audience: staff assist -->

### Tibbiy sir {#security-medical}

<!-- audience: all -->

- **Tibbiy kartani** faqat MIG ekspert shifokori yoki assistans shifokori ochadi — sabab bilan, 15 daqiqaga. <!-- audience: staff assist -->
- **HR** hech qachon xodimlarning tashxislari, tashriflari va qoplashlarini koʻrmaydi.
- **Klinika** bemorni faqat uning polisini tekshirgandan keyin va boshqa klinikalardagi murojaatlar tarixisiz koʻradi.
- **Oila aʼzolari:** ota-ona oʻz farzandlarining maʼlumotlarini koʻradi; voyaga yetgan oila aʼzolarining maʼlumotlarini — faqat ularning roziligi bilan.
- **Anderrayter** mijozning zararlilik darajasini faqat agregatlarda koʻradi. <!-- audience: staff -->

### Hamkorlar va integratsiyalar {#security-partners}

<!-- audience: all -->

- Har bir hamkor faqat oʻz maʼlumotlarini koʻradi: klinika — oʻz klinikasini, assistans — hodisa sanasidagi oʻz sugʻurtalanganlarini. Begona maʼlumotlar soʻrovi «Topilmadi» ni qaytaradi.
- API kalitlarining maxfiy qismlari bir marta koʻrsatiladi. Ularni himoyalangan joyda saqlang. Sizib chiqishga ozgina shubha boʻlsa ham kalitni bekor qilish kerak. <!-- audience: staff clinic assist -->

### Maʼlumotlar qayerda saqlanadi {#security-storage}

<!-- audience: all -->

Ishchi tizimda barcha maʼlumotlar Oʻzbekistondagi serverlarda saqlanadi. Oʻz tizimlari orqali ulangan hamkorlar ham shartnomaga koʻra sugʻurtalanganlar maʼlumotlarini Oʻzbekistonda saqlashi shart.

### Agar biror narsa notoʻgʻri ketgan boʻlsa {#security-incident}

<!-- audience: all -->

Shubhali faollikni payqadingizmi, begona maʼlumotlarni xato ochdingizmi yoki faylni notoʻgʻri qabul qiluvchiga yubordingizmi — **darhol MIG administratoriga xabar bering**. Qanchalik tez boʻlsa, oqibatlarni cheklash shunchalik oson: administrator audit jurnalini koʻradi va kirish huquqlarini bekor qilishi mumkin.

## 19. Holatlar maʼlumotnomasi {#statuses}

<!-- audience: all -->

Asosiy obyektlarning holatlari ular odatda oʻtadigan tartibda.

| Obyekt | Holatlar |
| --- | --- |
| Mijoz | Lid → Muzokaralar → Faol → Uzaytirish → Muddati tugagan | <!-- audience: staff -->
| Bitim | Lid → Baholash uchun maʼlumotlar → Kotirovka → TT yuborildi → TT qabul qilindi → Shartnoma: qoralama → Yuristda → Mijozga yuborilgan → Imzolash → Toʻlov kutilmoqda → Amalda; yoki Yutqazildi (sabab bilan) | <!-- audience: staff -->
| Kotirovka | Qoralama → Kelishuvda → Tasdiqlangan / Rad etilgan | <!-- audience: staff -->
| Tijorat taklifi | Qoralama → Yuborilgan → Qabul qilingan / Rad etilgan; Qaytarib olingan | <!-- audience: staff hr -->
| Shartnoma | Qoralama → Yuristda → Kelishilgan → Yuborilgan → Imzolash → Imzolangan → Amalda → Bekor qilingan / Muddati tugagan | <!-- audience: staff hr -->
| Qoʻshimcha kelishuv | Qoralama → Yuristda → Kelishilgan → Yuborilgan → Imzolash → Imzolangan | <!-- audience: staff hr -->
| Oʻzgartirish arizasi | Kutilmoqda → Qoʻshimcha kelishuvga kiritilgan / Bekor qilingan | <!-- audience: staff hr -->
| Polis | Amalda → Muddati tugagan / Bekor qilingan | <!-- audience: all -->
| Sugʻurtalangan shaxs | Faol → Chiqarilgan | <!-- audience: all -->
| Shifokor qabuliga yozilish | Soʻralgan → Tasdiqlandi / Rad etildi / Koʻchirildi → Boʻlib oʻtdi / Bekor qilindi | <!-- audience: staff insured clinic assist -->
| Kafolat xati | Soʻralgan → Hujjatlar kerak → Tasdiqlangan / Rad etilgan → Foydalanilgan / Muddati tugagan | <!-- audience: staff clinic assist -->
| Zarar (xodimlar uchun) | Yangi → Tekshiruvda → Tibbiy ekspertiza → Tasdiqlangan / Rad etilgan → Toʻlovga → Toʻlangan | <!-- audience: staff -->
| Qoplash (ilovada) | Qabul qildik → Tekshiryapmiz → Tasdiqlangan / Rad etildi → Pul kartada | <!-- audience: staff insured assist -->
| Klinika reyestri | Qoralama → Yuborilgan → Tekshiruvda → Qisman qabul qilingan / Qabul qilingan → Toʻlangan | <!-- audience: staff clinic assist -->
| Reyestr yoki assistans hisobi qatori | Tekshiruv kutilmoqda → Qabul qilingan / Rad etilgan → Eʼtiroz bildirilgan | <!-- audience: staff clinic assist -->
| Assistansning MIGga hisobi | Qoralama → Yuborilgan → Tekshiruvda → Qisman qabul qilingan / Qabul qilingan → Toʻlangan | <!-- audience: staff assist -->
| Mijozga hisob | Toʻlanmagan → Qisman toʻlangan → Toʻlangan; Muddati oʻtgan | <!-- audience: staff hr -->
| Limitni oʻzgartirish soʻrovi | Kutilmoqda → Tasdiqlangan / Rad etilgan | <!-- audience: staff -->
| Assistans murojaati | Yangi → Ishda → Kutilmoqda → Hal qilindi | <!-- audience: staff assist -->
| Koʻchirish paketi | Tekshiruv → Qoʻllashga tayyor → Qoʻllandi → Bekor qilindi | <!-- audience: staff -->

**Jadvallardagi ranglar:** yashil — hammasi joyida yoki yakunlangan; toʻq sariq — eʼtibor talab qiladi (muddat yaqin, limit tugayapti, qaror kutilmoqda); qizil — muddati oʻtgan yoki rad etilgan; kulrang — qoralama yoki faol emas.

## 20. Prototipning demo versiyasi {#demo}

<!-- audience: demo -->

Hozir tizim soxta maʼlumotlardagi prototip sifatida ishlaydi: siz qilgan hamma narsa faqat brauzeringiz varagʻida saqlanadi va u yopilganda tiklanadi. Tizim haqiqiy maʼlumotlarga oʻtganda bu boʻlim olib tashlanadi.

### Ekran yuqorisidagi demo banner {#demo-banner}

<!-- audience: demo -->

- **«… sifatida kirish»** — portallar boʻyicha guruhlangan (MIG, Assistans, Klinika, Kompaniya HR xodimi, Sugʻurtalangan shaxs), qidiruvli istalgan rol bilan tezkor kirish. Kirish haqiqiy, oddiy tekshiruv orqali.
- **«Maʼlumotlarni tiklash»** — barcha demo maʼlumotlarni dastlabki holatga qaytarish.
- **«Tarmoq uzilishlarini imitatsiya qilish»** — tizim xatolarni qanday koʻrsatishini koʻrish uchun soʻrovlarning bir qismi muvaffaqiyatsiz boʻladi.

### Asosiy demo akkauntlar {#demo-accounts}

<!-- audience: demo -->

Hammaning paroli `Demo-2026!`, ikkinchi omil va SMS kodi — `000000`.

| Rol | Kirish |
| --- | --- |
| Sotuv menejeri | `sales@demo.mig.uz` |
| Anderrayter / Anderrayting rahbari (imzolovchi) | `underwriter@demo.mig.uz` / `underwriter-head@demo.mig.uz` |
| Yurist | `legal@demo.mig.uz` |
| ITS kuratori | `operator@demo.mig.uz` |
| Zararlar boʻyicha mutaxassis / Rahbar | `claims@demo.mig.uz` / `claims-head@demo.mig.uz` |
| Ekspert shifokor | `doctor@demo.mig.uz` |
| Buxgalter | `accountant@demo.mig.uz` |
| Administrator / Ikkinchi administrator | `admin@demo.mig.uz` / `admin2@demo.mig.uz` |
| Kompaniya HR xodimi | `hr@demo-client.uz` |
| Registrator / Klinika administratori | `registrar@demo-clinic.uz` / `admin@demo-clinic.uz` |
| Assistans: operator, shifokor, moliyachi, administrator | `asst-operator@`, `asst-doctor@`, `asst-billing@`, `asst-admin@demo-assist.uz` |
| Sugʻurtalangan shaxs / uning turmush oʻrtogʻi | ilovaning kirish ekranida telefon `+998 90 000 00 01` / `+998 90 000 00 02` |

Toʻliq dolzarb roʻyxat — «… sifatida kirish» da.

### Namoyish uchun maslahatlar {#demo-tips}

<!-- audience: demo -->

- Rollar oʻrtasida «… sifatida kirish» orqali **xuddi shu varaqda** oʻting — aks holda bir rol ostida qilingan oʻzgarishlar boshqasida koʻrinmaydi.
- 15 daqiqalik qulay stsenariy: menejer lid yaratadi → anderrayter vakolatdan yuqori chegirma bilan kotirovkani hisoblaydi → rahbar tasdiqlaydi → tijorat taklifi → HR qabul qiladi → oʻzgartirilgan bandli shartnoma → yurist maʼqullaydi → imzolash → toʻlov → sugʻurtalangan shaxs sertifikatni koʻradi → klinika uning QR ini tekshiradi → assistans kafolat xatini hal qiladi.
- Xavfsizlikni koʻrsatish uchun: HR tashxislarni koʻrmaydi; shaxsga doir maʼlumotlarning ochilishi darhol audit jurnalida paydo boʻladi; anderrayter oʻz soʻrovini tasdiqlay olmaydi; begona boʻlimga havola «Ruxsat yoʻq» ga olib boradi.

### Prototipda nima imitatsiya qilinadi {#demo-simulated}

<!-- audience: demo -->

E-IMZO ERI va EHA, SMS, cheklarni tanib olish, SI javoblari, vebxuklar va 1C bilan almashinuv imitatsiya sifatida ishlaydi. Shartnoma, qoʻshimcha kelishuv, sertifikat va xatlar shablonlari MIG matnlari olinguncha «ШАБЛОН-ЗАГЛУШКА» (SHABLON-ZAGLUSHKA) suv belgisi bilan vaqtinchalik namunalardir. Barcha chegaralar va muddatlar — MIG «ITS parametrlari» da almashtiradigan demo qiymatlar.
