const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Initialize SQLite database
const db = new Database(path.join(__dirname, 'tronos_db.sqlite'), { verbose: console.log });
db.pragma('journal_mode = WAL');

function initDb() {
  try {
    // Create tables
    db.exec(`
      CREATE TABLE IF NOT EXISTS folders (
        id TEXT PRIMARY KEY,
        nombre TEXT NOT NULL,
        fecha TEXT NOT NULL,
        ruta TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS preprogrammed (
        id TEXT PRIMARY KEY,
        fecha TEXT,
        pago TEXT NOT NULL DEFAULT 'Efectivo',
        cliente TEXT NOT NULL,
        contacto TEXT,
        origen TEXT,
        status TEXT NOT NULL DEFAULT 'PRE',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS services (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        fecha TEXT NOT NULL,
        pago TEXT NOT NULL,
        vendedor TEXT,
        cot TEXT,
        tipo_mov TEXT,
        motivo TEXT,
        cliente TEXT NOT NULL,
        contacto TEXT NOT NULL,
        origen TEXT,
        obra TEXT,
        cont_contrata TEXT,
        direccion TEXT NOT NULL,
        ubicacion TEXT,
        h_e TEXT,
        h_e_m TEXT,
        f_r TEXT,
        h_r TEXT,
        h_r_m TEXT,
        status TEXT NOT NULL DEFAULT 'PENDIENTE',
        chk_entrega INTEGER NOT NULL DEFAULT 0,
        chk_limpieza INTEGER NOT NULL DEFAULT 0,
        chk_retiro INTEGER NOT NULL DEFAULT 0,
        extra_status TEXT,
        extra_folderId TEXT,
        extra_chk_entrega TEXT,
        extra_chk_limpieza TEXT,
        extra_chk_retiro TEXT,
        folderId TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        service_id TEXT NOT NULL,
        cant INTEGER NOT NULL DEFAULT 1,
        modelo TEXT NOT NULL,
        sym INTEGER NOT NULL DEFAULT 0,
        n_dir TEXT,
        n_cont TEXT,
        n_obra TEXT,
        n_ubi TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS cleanings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        service_id TEXT NOT NULL,
        f_l TEXT NOT NULL,
        h_l_d TEXT,
        h_l_a TEXT,
        status TEXT NOT NULL DEFAULT 'PENDIENTE',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE
      );
    `);
    console.log('✅ SQLite database initialized successfully');
  } catch (error) {
    console.error('❌ Error initializing SQLite:', error.message);
    process.exit(1);
  }
}

initDb();

app.get('/api/health', (req, res) => {
  res.json({ status: 'online', database: 'SQLite', timestamp: new Date() });
});

app.get('/api/state', (req, res) => {
  try {
    const foldersRows = db.prepare('SELECT * FROM folders').all();
    const folders = foldersRows.map(f => ({ id: f.id, nombre: f.nombre, fecha: f.fecha, ruta: f.ruta }));

    const preRows = db.prepare('SELECT * FROM preprogrammed').all();
    const preprogrammed = preRows.map(p => ({ id: p.id, fecha: p.fecha, pago: p.pago, cliente: p.cliente, contacto: p.contacto, origen: p.origen, status: p.status }));

    const servicesRows = db.prepare('SELECT * FROM services').all();
    const productsRows = db.prepare('SELECT * FROM products').all();
    const cleaningsRows = db.prepare('SELECT * FROM cleanings').all();

    const productsMap = {};
    productsRows.forEach(p => {
      if (!productsMap[p.service_id]) productsMap[p.service_id] = [];
      productsMap[p.service_id].push({ cant: p.cant, modelo: p.modelo, sym: p.sym === 1, n_dir: p.n_dir, n_cont: p.n_cont, n_obra: p.n_obra, n_ubi: p.n_ubi });
    });

    const cleaningsMap = {};
    cleaningsRows.forEach(c => {
      if (!cleaningsMap[c.service_id]) cleaningsMap[c.service_id] = [];
      cleaningsMap[c.service_id].push({ f_l: c.f_l, h_l_d: c.h_l_d, h_l_a: c.h_l_a, status: c.status });
    });

    const database = servicesRows.map(s => ({
      id: s.id, type: s.type, fecha: s.fecha, pago: s.pago, vendedor: s.vendedor, cot: s.cot,
      tipo_mov: s.tipo_mov, motivo: s.motivo, cliente: s.cliente, contacto: s.contacto, origen: s.origen,
      obra: s.obra, cont_contrata: s.cont_contrata, direccion: s.direccion, ubicacion: s.ubicacion,
      h_e: s.h_e, h_e_m: s.h_e_m, f_r: s.f_r, h_r: s.h_r, h_r_m: s.h_r_m, status: s.status,
      chk_entrega: s.chk_entrega === 1, chk_limpieza: s.chk_limpieza === 1, chk_retiro: s.chk_retiro === 1,
      extra_status: typeof s.extra_status === 'string' ? JSON.parse(s.extra_status) : s.extra_status || {},
      extra_folderId: typeof s.extra_folderId === 'string' ? JSON.parse(s.extra_folderId) : s.extra_folderId || {},
      extra_chk_entrega: typeof s.extra_chk_entrega === 'string' ? JSON.parse(s.extra_chk_entrega) : s.extra_chk_entrega || {},
      extra_chk_limpieza: typeof s.extra_chk_limpieza === 'string' ? JSON.parse(s.extra_chk_limpieza) : s.extra_chk_limpieza || {},
      extra_chk_retiro: typeof s.extra_chk_retiro === 'string' ? JSON.parse(s.extra_chk_retiro) : s.extra_chk_retiro || {},
      folderId: s.folderId, productos: productsMap[s.id] || [], limpiezas: cleaningsMap[s.id] || []
    }));

    res.json({ database, preprogrammed, folders });
  } catch (error) {
    res.status(500).json({ error: 'Error al recuperar datos', details: error.message });
  }
});

app.post('/api/sync', (req, res) => {
  const { database, preprogrammed, folders, deletedIds } = req.body;
  if (!Array.isArray(database) || !Array.isArray(preprogrammed) || !Array.isArray(folders))
    return res.status(400).json({ error: 'Formato invalido.' });

  const toDelete = {
    services:      Array.isArray(deletedIds?.services)      ? deletedIds.services      : [],
    folders:       Array.isArray(deletedIds?.folders)       ? deletedIds.folders       : [],
    preprogrammed: Array.isArray(deletedIds?.preprogrammed) ? deletedIds.preprogrammed : []
  };

  try {
    // Begin transaction
    const transaction = db.transaction(() => {
      // Delete marked items
      if (toDelete.services.length > 0) {
        const stmt = db.prepare('DELETE FROM services WHERE id IN (' + toDelete.services.map(() => '?').join(',') + ')');
        stmt.run(...toDelete.services);
      }
      if (toDelete.preprogrammed.length > 0) {
        const stmt = db.prepare('DELETE FROM preprogrammed WHERE id IN (' + toDelete.preprogrammed.map(() => '?').join(',') + ')');
        stmt.run(...toDelete.preprogrammed);
      }
      if (toDelete.folders.length > 0) {
        const stmt = db.prepare('DELETE FROM folders WHERE id IN (' + toDelete.folders.map(() => '?').join(',') + ')');
        stmt.run(...toDelete.folders);
      }

      // Insert/update folders
      const folderStmt = db.prepare(`
        INSERT INTO folders (id, nombre, fecha, ruta)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET nombre=excluded.nombre, fecha=excluded.fecha, ruta=excluded.ruta
      `);
      for (const f of folders) {
        folderStmt.run(f.id, f.nombre || '', f.fecha || '', f.ruta || null);
      }

      // Insert/update preprogrammed
      const preStmt = db.prepare(`
        INSERT INTO preprogrammed (id, fecha, pago, cliente, contacto, origen, status)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET fecha=excluded.fecha, pago=excluded.pago, cliente=excluded.cliente, contacto=excluded.contacto, origen=excluded.origen, status=excluded.status
      `);
      for (const p of preprogrammed) {
        preStmt.run(p.id, p.fecha || null, p.pago || 'Efectivo', p.cliente || '', p.contacto || null, p.origen || null, p.status || 'PRE');
      }

      // Insert/update services
      const serviceStmt = db.prepare(`
        INSERT INTO services (id, type, fecha, pago, vendedor, cot, tipo_mov, motivo, cliente, contacto, origen, obra, cont_contrata, direccion, ubicacion, h_e, h_e_m, f_r, h_r, h_r_m, status, chk_entrega, chk_limpieza, chk_retiro, extra_status, extra_folderId, extra_chk_entrega, extra_chk_limpieza, extra_chk_retiro, folderId)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET type=excluded.type, fecha=excluded.fecha, pago=excluded.pago, vendedor=excluded.vendedor, cot=excluded.cot, tipo_mov=excluded.tipo_mov, motivo=excluded.motivo, cliente=excluded.cliente, contacto=excluded.contacto, origen=excluded.origen, obra=excluded.obra, cont_contrata=excluded.cont_contrata, direccion=excluded.direccion, ubicacion=excluded.ubicacion, h_e=excluded.h_e, h_e_m=excluded.h_e_m, f_r=excluded.f_r, h_r=excluded.h_r, h_r_m=excluded.h_r_m, status=excluded.status, chk_entrega=excluded.chk_entrega, chk_limpieza=excluded.chk_limpieza, chk_retiro=excluded.chk_retiro, extra_status=excluded.extra_status, extra_folderId=excluded.extra_folderId, extra_chk_entrega=excluded.extra_chk_entrega, extra_chk_limpieza=excluded.extra_chk_limpieza, extra_chk_retiro=excluded.extra_chk_retiro, folderId=excluded.folderId
      `);

      const productDeleteStmt = db.prepare('DELETE FROM products WHERE service_id = ?');
      const productStmt = db.prepare('INSERT INTO products (service_id, cant, modelo, sym, n_dir, n_cont, n_obra, n_ubi) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');

      const cleaningDeleteStmt = db.prepare('DELETE FROM cleanings WHERE service_id = ?');
      const cleaningStmt = db.prepare('INSERT INTO cleanings (service_id, f_l, h_l_d, h_l_a, status) VALUES (?, ?, ?, ?, ?)');

      for (const service of database) {
        let validFolderId = null;
        if (service.folderId) {
          const folder = db.prepare('SELECT id FROM folders WHERE id = ?').get(service.folderId);
          if (folder) validFolderId = service.folderId;
        }

        serviceStmt.run(
          service.id, service.type || '', service.fecha || '', service.pago || 'Efectivo',
          service.vendedor || null, service.cot || null, service.tipo_mov || null, service.motivo || null,
          service.cliente || '', service.contacto || '', service.origen || null, service.obra || null, service.cont_contrata || null,
          service.direccion || '', service.ubicacion || null, service.h_e || null, service.h_e_m || null,
          service.f_r || null, service.h_r || null, service.h_r_m || null, service.status || 'PENDIENTE',
          service.chk_entrega ? 1 : 0, service.chk_limpieza ? 1 : 0, service.chk_retiro ? 1 : 0,
          JSON.stringify(service.extra_status || {}), JSON.stringify(service.extra_folderId || {}),
          JSON.stringify(service.extra_chk_entrega || {}), JSON.stringify(service.extra_chk_limpieza || {}),
          JSON.stringify(service.extra_chk_retiro || {}), validFolderId
        );

        productDeleteStmt.run(service.id);
        if (Array.isArray(service.productos) && service.productos.length > 0) {
          for (const p of service.productos) {
            productStmt.run(service.id, p.cant || 1, p.modelo || 'ESTANDAR', p.sym ? 1 : 0, p.n_dir || null, p.n_cont || null, p.n_obra || null, p.n_ubi || null);
          }
        }

        cleaningDeleteStmt.run(service.id);
        if (Array.isArray(service.limpiezas) && service.limpiezas.length > 0) {
          for (const c of service.limpiezas) {
            cleaningStmt.run(service.id, c.f_l || '', c.h_l_d || null, c.h_l_a || null, c.status || 'PENDIENTE');
          }
        }
      }
    });

    transaction();
    res.json({ success: true, message: 'Sincronizacion UPSERT exitosa' });
  } catch (error) {
    res.status(500).json({ error: 'Error interno', details: error.message });
  }
});

app.listen(PORT, () => {
  console.log('🚀 Servidor en http://localhost:' + PORT);
});
