const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// In-memory data store
let state = {
  database: [],
  preprogrammed: [],
  folders: []
};

app.get('/api/health', (req, res) => {
  res.json({ status: 'online', database: 'In-Memory Demo', timestamp: new Date() });
});

app.get('/api/state', (req, res) => {
  console.log('✅ GET /api/state - Returning current state');
  res.json(state);
});

app.post('/api/sync', (req, res) => {
  const { database, preprogrammed, folders, deletedIds } = req.body;

  console.log('📝 POST /api/sync');
  console.log(`   - Services: ${database?.length || 0}`);
  console.log(`   - Preprogrammed: ${preprogrammed?.length || 0}`);
  console.log(`   - Folders: ${folders?.length || 0}`);

  if (database && Array.isArray(database)) {
    // Show cleaning data for debugging
    database.forEach(service => {
      if (service.limpiezas && service.limpiezas.length > 0) {
        console.log(`   📌 Service ${service.id}: ${service.limpiezas.length} limpiezas`);
        service.limpiezas.forEach((l, i) => {
          console.log(`      [${i}] f_l=${l.f_l}, h_l_d=${l.h_l_d}, status=${l.status}`);
        });
      }
    });
  }

  // Update state
  state.database = database || [];
  state.preprogrammed = preprogrammed || [];
  state.folders = folders || [];

  res.json({ success: true, message: 'Sincronizacion exitosa' });
});

app.listen(PORT, () => {
  console.log('\n================================================');
  console.log(`🚀 TRONOS Server iniciado`);
  console.log(`📍 http://localhost:${PORT}`);
  console.log(`💾 Usando almacenamiento en memoria (DEMO)`);
  console.log('================================================\n');
});
