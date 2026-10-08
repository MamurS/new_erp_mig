-- The JWT secret and lifetime for SQL that reads them (official self-hosted stack; runs once on an empty volume).
\set jwt_secret `echo "$JWT_SECRET"`
\set jwt_exp `echo "$JWT_EXP"`

alter database postgres set "app.settings.jwt_secret" to :'jwt_secret';
alter database postgres set "app.settings.jwt_exp" to :'jwt_exp';
