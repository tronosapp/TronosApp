const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'tronos_db',
  port: parseInt(process.env.DB_PORT || '3306'),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

if (process.env.DB_HOST && process.env.DB_HOST.includes('tidbcloud')) {
  dbConfig.ssl = { minVersion: 'TLSv1.2', rejectUnauthorized: true };
}

let pool;

async function initDb() {
  try {
    pool = mysql.createPool(dbConfig);
    const connection = await pool.getConnection();
    console.log('Conexion exitosa a MySQL:', dbConfig.database);
    connection.release();
  } catch (error) {
    console.error('Error al conectar a MySQL.', error.message);
    setTimeout(initDb, 10000);
  }
}
initDb();

app.get('/api/health', (req, res) => {
  res.json({ status: 'online', database: dbConfig.database, timestamp: new Date() });
});

app.get('/api/state', async (req, res) => {
  if (!pool) return res.status(500).json({ error: 'DB no inicializada' });
  try {
    const [foldersRows] = await pool.query('SELECT * FROM folders');
    const folders = foldersRows.map(f => ({ id: f.id, nombre: f.nombre, fecha: f.fecha, ruta: f.ruta }));
    const [preRows] = await pool.query('SELECT * FROM preprogrammed');
    const preprogrammed = preRows.map(p => ({ id: p.id, fecha: p.fecha, pago: p.pago, cliente: p.cliente, contacto: p.contacto, status: p.status }));
    const [servicesRows] = await pool.query('SELECT * FROM services');
    const [productsRows] = await pool.query('SELECT * FROM products');
    const [cleaningsRows] = await pool.query('SELECT * FROM cleanings');

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
      tipo_mov: s.tipo_mov, motivo: s.motivo, cliente: s.cliente, contacto: s.contacto,
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

// FIX v3: UPSERT en lugar de DELETE+INSERT - resuelve race condition multi-usuario
app.post('/api/sync', async (req, res) => {
  if (!pool) return res.status(500).json({ error: 'DB no inicializada' });
  const { database, preprogrammed, folders, deletedIds } = req.body;
  if (!Array.isArray(database) || !Array.isArray(preprogrammed) || !Array.isArray(folders))
    return res.status(400).json({ error: 'Formato invalido.' });

  const toDelete = {
    services:      Array.isArray(deletedIds?.services)      ? deletedIds.services      : [],
    folders:       Array.isArray(deletedIds?.folders)       ? deletedIds.folders       : [],
    preprogrammed: Array.isArray(deletedIds?.preprogrammed) ? deletedIds.preprogrammed : []
  };

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    if (toDelete.services.length > 0)
      await connection.query('DELETE FROM services WHERE id IN (?)', [toDelete.services]);
    if (toDelete.preprogrammed.length > 0)
      await connection.query('DELETE FROM preprogrammed WHERE id IN (?)', [toDelete.preprogrammed]);
    if (toDelete.folders.length > 0)
      await connection.query('DELETE FROM folders WHERE id IN (?)', [toDelete.folders]);

    for (const f of folders) {
      await connection.query(
        'INSERT INTO folders (id,nombre,fecha,ruta) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE nombre=VALUES(nombre),fecha=VALUES(fecha),ruta=VALUES(ruta)',
        [f.id, f.nombre||'', f.fecha||'', f.ruta||null]
      );
    }

    for (const p of preprogrammed) {
      await connection.query(
        'INSERT INTO preprogrammed (id,fecha,pago,cliente,contacto,status) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE fecha=VALUES(fecha),pago=VALUES(pago),cliente=VALUES(cliente),contacto=VALUES(contacto),status=VALUES(status)',
        [p.id, p.fecha||null, p.pago||'Efectivo', p.cliente||'', p.contacto||null, p.status||'PRE']
      );
    }

    for (const service of database) {
      let validFolderId = null;
      if (service.folderId) {
        const [fr] = await connection.query('SELECT id FROM folders WHERE id = ?', [service.folderId]);
        if (fr.length > 0) validFolderId = service.folderId;
      }
      await connection.query(
        `INSERT INTO services (id,type,fecha,pago,vendedor,cot,tipo_mov,motivo,cliente,contacto,obra,cont_contrata,direccion,ubicacion,h_e,h_e_m,f_r,h_r,h_r_m,status,chk_entrega,chk_limpieza,chk_retiro,extra_status,extra_folderId,extra_chk_entrega,extra_chk_limpieza,extra_chk_retiro,folderId)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE type=VALUES(type),fecha=VALUES(fecha),pago=VALUES(pago),vendedor=VALUES(vendedor),cot=VALUES(cot),tipo_mov=VALUES(tipo_mov),motivo=VALUES(motivo),cliente=VALUES(cliente),contacto=VALUES(contacto),obra=VALUES(obra),cont_contrata=VALUES(cont_contrata),direccion=VALUES(direccion),ubicacion=VALUES(ubicacion),h_e=VALUES(h_e),h_e_m=VALUES(h_e_m),f_r=VALUES(f_r),h_r=VALUES(h_r),h_r_m=VALUES(h_r_m),status=VALUES(status),chk_entrega=VALUES(chk_entrega),chk_limpieza=VALUES(chk_limpieza),chk_retiro=VALUES(chk_retiro),extra_status=VALUES(extra_status),extra_folderId=VALUES(extra_folderId),extra_chk_entrega=VALUES(extra_chk_entrega),extra_chk_limpieza=VALUES(extra_chk_limpieza),extra_chk_retiro=VALUES(extra_chk_retiro),folderId=VALUES(folderId)`,
        [service.id,service.type||'',service.fecha||'',service.pago||'Efectivo',service.vendedor||null,service.cot||null,service.tipo_mov||null,service.motivo||null,service.cliente||'',service.contacto||'',service.obra||null,service.cont_contrata||null,service.direccion||'',service.ubicacion||null,service.h_e||null,service.h_e_m||null,service.f_r||null,service.h_r||null,service.h_r_m||null,service.status||'PENDIENTE',service.chk_entrega?1:0,service.chk_limpieza?1:0,service.chk_retiro?1:0,JSON.stringify(service.extra_status||{}),JSON.stringify(service.extra_folderId||{}),JSON.stringify(service.extra_chk_entrega||{}),JSON.stringify(service.extra_chk_limpieza||{}),JSON.stringify(service.extra_chk_retiro||{}),validFolderId]
      );

      await connection.query('DELETE FROM products WHERE service_id = ?', [service.id]);
      if (Array.isArray(service.productos) && service.productos.length > 0) {
        const pv = service.productos.map(p => [service.id,p.cant||1,p.modelo||'ESTANDAR',p.sym?1:0,p.n_dir||null,p.n_cont||null,p.n_obra||null,p.n_ubi||null]);
        await connection.query('INSERT INTO products (service_id,cant,modelo,sym,n_dir,n_cont,n_obra,n_ubi) VALUES ?',[pv]);
      }
      await connection.query('DELETE FROM cleanings WHERE service_id = ?', [service.id]);
      if (Array.isArray(service.limpiezas) && service.limpiezas.length > 0) {
        const cv = service.limpiezas.map(c => [service.id,c.f_l||'',c.h_l_d||null,c.h_l_a||null,c.status||'PENDIENTE']);
        await connection.query('INSERT INTO cleanings (service_id,f_l,h_l_d,h_l_a,status) VALUES ?',[cv]);
      }
    }

    await connection.commit();
    res.json({ success: true, message: 'Sincronizacion UPSERT exitosa' });
  } catch (error) {
    await connection.rollback();
    res.status(500).json({ error: 'Error interno', details: error.message });
  } finally {
    connection.release();
  }
});

app.listen(PORT, () => {
  console.log('Servidor en http://localhost:' + PORT);
});
