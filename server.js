const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '100mb' })); // Permitir payloads grandes para la sincronización masiva
app.use(express.urlencoded({ limit: '100mb', extended: true }));

// Servir archivos estáticos de la aplicación (HTML, JS, CSS) desde la carpeta 'public'
app.use(express.static(path.join(__dirname, 'public')));

// Configuración de la Pool de Conexiones de MySQL
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

// TiDB Cloud requires SSL
if (process.env.DB_HOST && process.env.DB_HOST.includes('tidbcloud')) {
  dbConfig.ssl = {
    minVersion: 'TLSv1.2',
    rejectUnauthorized: true
  };
}

let pool;

// Inicialización de la conexión
async function initDb() {
  try {
    pool = mysql.createPool(dbConfig);
    // Verificar conexión probando un simple query
    const connection = await pool.getConnection();
    console.log('✅ Conexión exitosa a la base de datos MySQL:', dbConfig.database);
    connection.release();
  } catch (error) {
    console.error('❌ Error al conectar a MySQL. Asegúrate de que el servidor MySQL está encendido y la base de datos creada.', error.message);
    console.log('🔄 Reintentando en 10 segundos...');
    setTimeout(initDb, 10000);
  }
}

initDb();

// Ruta de estado del API (opcional, para corroborar el estado)
app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    message: 'TRONOS Database API Server is running',
    database: dbConfig.database,
    timestamp: new Date()
  });
});

// =========================================================================
// ENDPOINT: OBTENER TODO EL ESTADO (Para iniciar la aplicación frontend)
// =========================================================================
app.get('/api/state', async (req, res) => {
  if (!pool) {
    return res.status(500).json({ error: 'La base de datos no está inicializada' });
  }

  try {
    // 1. Obtener carpetas
    const [foldersRows] = await pool.query('SELECT * FROM folders');
    const folders = foldersRows.map(f => ({
      id: f.id,
      nombre: f.nombre,
      fecha: f.fecha,
      ruta: f.ruta
    }));

    // 2. Obtener preprogramados
    const [preRows] = await pool.query('SELECT * FROM preprogrammed');
    const preprogrammed = preRows.map(p => ({
      id: p.id,
      fecha: p.fecha,
      pago: p.pago,
      cliente: p.cliente,
      contacto: p.contacto,
      status: p.status
    }));

    // 3. Obtener servicios
    const [servicesRows] = await pool.query('SELECT * FROM services');
    
    // 4. Obtener productos y limpiezas asociados
    const [productsRows] = await pool.query('SELECT * FROM products');
    const [cleaningsRows] = await pool.query('SELECT * FROM cleanings');

    // Agrupar productos por service_id
    const productsMap = {};
    productsRows.forEach(p => {
      if (!productsMap[p.service_id]) productsMap[p.service_id] = [];
      productsMap[p.service_id].push({
        cant: p.cant,
        modelo: p.modelo,
        sym: p.sym === 1,
        n_dir: p.n_dir,
        n_cont: p.n_cont,
        n_obra: p.n_obra,
        n_ubi: p.n_ubi
      });
    });

    // Agrupar limpiezas por service_id
    const cleaningsMap = {};
    cleaningsRows.forEach(c => {
      if (!cleaningsMap[c.service_id]) cleaningsMap[c.service_id] = [];
      cleaningsMap[c.service_id].push({
        f_l: c.f_l,
        h_l_d: c.h_l_d,
        h_l_a: c.h_l_a,
        status: c.status
      });
    });

    // Reconstruir la lista de servicios con sus respectivas dependencias
    const database = servicesRows.map(s => {
      return {
        id: s.id,
        type: s.type,
        fecha: s.fecha,
        pago: s.pago,
        vendedor: s.vendedor,
        cot: s.cot,
        tipo_mov: s.tipo_mov,
        motivo: s.motivo,
        cliente: s.cliente,
        contacto: s.contacto,
        obra: s.obra,
        cont_contrata: s.cont_contrata,
        direccion: s.direccion,
        ubicacion: s.ubicacion,
        h_e: s.h_e,
        h_e_m: s.h_e_m,
        f_r: s.f_r,
        h_r: s.h_r,
        h_r_m: s.h_r_m,
        status: s.status,
        chk_entrega: s.chk_entrega === 1,
        chk_limpieza: s.chk_limpieza === 1,
        chk_retiro: s.chk_retiro === 1,
        
        // Deserializar campos JSON de MySQL
        extra_status: typeof s.extra_status === 'string' ? JSON.parse(s.extra_status) : s.extra_status || {},
        extra_folderId: typeof s.extra_folderId === 'string' ? JSON.parse(s.extra_folderId) : s.extra_folderId || {},
        extra_chk_entrega: typeof s.extra_chk_entrega === 'string' ? JSON.parse(s.extra_chk_entrega) : s.extra_chk_entrega || {},
        extra_chk_limpieza: typeof s.extra_chk_limpieza === 'string' ? JSON.parse(s.extra_chk_limpieza) : s.extra_chk_limpieza || {},
        extra_chk_retiro: typeof s.extra_chk_retiro === 'string' ? JSON.parse(s.extra_chk_retiro) : s.extra_chk_retiro || {},
        
        folderId: s.folderId,
        productos: productsMap[s.id] || [],
        limpiezas: cleaningsMap[s.id] || []
      };
    });

    res.json({
      database,
      preprogrammed,
      folders
    });

  } catch (error) {
    console.error('❌ Error al obtener el estado:', error);
    res.status(500).json({ error: 'Error al recuperar los datos de la base de datos', details: error.message });
  }
});

// =========================================================================
// ENDPOINT: SINCRONIZAR ESTADO (Guardado rápido y transaccional desde el cliente)
// =========================================================================
app.post('/api/sync', async (req, res) => {
  if (!pool) {
    return res.status(500).json({ error: 'La base de datos no está inicializada' });
  }

  const { database, preprogrammed, folders } = req.body;
  if (!Array.isArray(database) || !Array.isArray(preprogrammed) || !Array.isArray(folders)) {
    return res.status(400).json({ error: 'Formato de datos inválido. Se requieren arreglos de database, preprogrammed y folders.' });
  }

  const connection = await pool.getConnection();

  try {
    // Iniciar transacción atómica para garantizar que no queden datos corruptos si falla a la mitad
    await connection.beginTransaction();

    // 1. Limpiar base de datos actual (los borrados en cascada limpian productos y limpiezas automáticamente)
    await connection.query('DELETE FROM products');
    await connection.query('DELETE FROM cleanings');
    await connection.query('DELETE FROM services');
    await connection.query('DELETE FROM preprogrammed');
    await connection.query('DELETE FROM folders');

    // 2. Insertar Carpetas
    if (folders.length > 0) {
      const foldersValues = folders.map(f => [
        f.id,
        f.nombre || '',
        f.fecha || '',
        f.ruta || null
      ]);
      await connection.query(
        'INSERT INTO folders (id, nombre, fecha, ruta) VALUES ?',
        [foldersValues]
      );
    }

    // 3. Insertar Preprogramados
    if (preprogrammed.length > 0) {
      const preprogrammedValues = preprogrammed.map(p => [
        p.id,
        p.fecha || null,
        p.pago || 'Efectivo',
        p.cliente || '',
        p.contacto || null,
        p.status || 'PRE'
      ]);
      await connection.query(
        'INSERT INTO preprogrammed (id, fecha, pago, cliente, contacto, status) VALUES ?',
        [preprogrammedValues]
      );
    }

    // 4. Insertar Servicios y sus dependencias (productos y limpiezas)
    for (const service of database) {
      const folderIdVal = service.folderId || null;
      
      // Sanitizar y validar existencia de folderId en folders creados arriba
      let validFolderId = null;
      if (folderIdVal) {
        const folderExists = folders.some(f => String(f.id) === String(folderIdVal));
        if (folderExists) validFolderId = folderIdVal;
      }

      await connection.query(
        `INSERT INTO services (
          id, type, fecha, pago, vendedor, cot, tipo_mov, motivo, cliente, contacto, 
          obra, cont_contrata, direccion, ubicacion, h_e, h_e_m, f_r, h_r, h_r_m, 
          status, chk_entrega, chk_limpieza, chk_retiro, 
          extra_status, extra_folderId, extra_chk_entrega, extra_chk_limpieza, extra_chk_retiro,
          folderId
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          service.id,
          service.type || '',
          service.fecha || '',
          service.pago || 'Efectivo',
          service.vendedor || null,
          service.cot || null,
          service.tipo_mov || null,
          service.motivo || null,
          service.cliente || '',
          service.contacto || '',
          service.obra || null,
          service.cont_contrata || null,
          service.direccion || '',
          service.ubicacion || null,
          service.h_e || null,
          service.h_e_m || null,
          service.f_r || null,
          service.h_r || null,
          service.h_r_m || null,
          service.status || 'PENDIENTE',
          service.chk_entrega ? 1 : 0,
          service.chk_limpieza ? 1 : 0,
          service.chk_retiro ? 1 : 0,
          JSON.stringify(service.extra_status || {}),
          JSON.stringify(service.extra_folderId || {}),
          JSON.stringify(service.extra_chk_entrega || {}),
          JSON.stringify(service.extra_chk_limpieza || {}),
          JSON.stringify(service.extra_chk_retiro || {}),
          validFolderId
        ]
      );

      // Insertar productos asociados a este servicio
      if (Array.isArray(service.productos) && service.productos.length > 0) {
        const productsValues = service.productos.map(p => [
          service.id,
          p.cant || 1,
          p.modelo || 'ESTANDAR',
          p.sym ? 1 : 0,
          p.n_dir || null,
          p.n_cont || null,
          p.n_obra || null,
          p.n_ubi || null
        ]);
        await connection.query(
          'INSERT INTO products (service_id, cant, modelo, sym, n_dir, n_cont, n_obra, n_ubi) VALUES ?',
          [productsValues]
        );
      }

      // Insertar limpiezas asociadas a este servicio (para eventos)
      if (Array.isArray(service.limpiezas) && service.limpiezas.length > 0) {
        const cleaningsValues = service.limpiezas.map(c => [
          service.id,
          c.f_l || '',
          c.h_l_d || null,
          c.h_l_a || null,
          c.status || 'PENDIENTE'
        ]);
        await connection.query(
          'INSERT INTO cleanings (service_id, f_l, h_l_d, h_l_a, status) VALUES ?',
          [cleaningsValues]
        );
      }
    }

    // Confirmar la transacción
    await connection.commit();
    res.json({ success: true, message: 'Base de datos MySQL sincronizada con éxito' });

  } catch (error) {
    // Si algo sale mal, revertir todos los cambios de esta petición
    await connection.rollback();
    console.error('❌ Error durante la transacción de sincronización:', error);
    res.status(500).json({ error: 'Error interno en la base de datos durante la sincronización', details: error.message });
  } finally {
    connection.release();
  }
});

// Levantar el servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor ejecutándose en http://localhost:${PORT}`);
  console.log(`📂 Sirviendo la interfaz web desde la carpeta 'public'`);
});
