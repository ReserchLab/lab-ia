// Esquema de D1. Se crea solo la primera vez que el Worker arranca (no hace falta aplicar migraciones).
const VERSION = '1';
const SQL = [
  `CREATE TABLE IF NOT EXISTS ajustes (usuario TEXT NOT NULL, clave TEXT NOT NULL, valor TEXT NOT NULL, PRIMARY KEY (usuario, clave))`,
  `CREATE TABLE IF NOT EXISTS usuarios (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, hash TEXT NOT NULL, sal TEXT NOT NULL, rol TEXT NOT NULL DEFAULT 'usuario', clave_hash TEXT UNIQUE, clave_cifrada TEXT, clave_iv TEXT, creado INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS sesiones (token_hash TEXT PRIMARY KEY, usuario TEXT NOT NULL, expira INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS claves (usuario TEXT NOT NULL, proveedor TEXT NOT NULL, cifrada TEXT NOT NULL, iv TEXT NOT NULL, estado TEXT, detalle TEXT, creada INTEGER NOT NULL, PRIMARY KEY (usuario, proveedor))`,
  `CREATE TABLE IF NOT EXISTS conversaciones (id TEXT PRIMARY KEY, usuario TEXT NOT NULL, titulo TEXT NOT NULL, skill TEXT, memoria TEXT NOT NULL DEFAULT '', memoria_hasta INTEGER NOT NULL DEFAULT 0, creada INTEGER NOT NULL, actualizada INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS conv_usuario ON conversaciones (usuario, actualizada)`,
  `CREATE TABLE IF NOT EXISTS mensajes (id TEXT PRIMARY KEY, conversacion TEXT NOT NULL, rol TEXT NOT NULL, contenido TEXT NOT NULL, meta TEXT NOT NULL DEFAULT '{}', creado INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS mensajes_conv ON mensajes (conversacion, creado)`,
  `CREATE TABLE IF NOT EXISTS skills (usuario TEXT NOT NULL, id TEXT NOT NULL, md TEXT NOT NULL, actualizada INTEGER NOT NULL, PRIMARY KEY (usuario, id))`,
  `CREATE TABLE IF NOT EXISTS cache (clave TEXT PRIMARY KEY, valor TEXT NOT NULL, expira INTEGER NOT NULL)`,
];

let listo = false;

export async function asegurarEsquema(db) {
  if (listo) return;
  try {
    const v = await db.prepare("SELECT valor FROM ajustes WHERE usuario = '' AND clave = 'esquema'").first();
    if (v?.valor === VERSION) { listo = true; return; }
  } catch { /* la tabla aún no existe */ }
  await db.batch(SQL.map(s => db.prepare(s)));
  await db.prepare("INSERT OR REPLACE INTO ajustes (usuario, clave, valor) VALUES ('', 'esquema', ?)").bind(VERSION).run();
  listo = true;
}
