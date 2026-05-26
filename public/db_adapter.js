/**
 * =========================================================================
 * TRONOS DATABASE ADAPTER (MySQL Integration) - v3.0
 * =========================================================================
 * FIX v3: tracking de pendingDeletes - detecta IDs eliminados comparando
 * estado viejo vs nuevo en localStorage y los envia como deletedIds al
 * servidor para borrarlos sin afectar datos de otros usuarios concurrentes.
 */

(function() {
  'use strict';

  const API_URL = window.location.origin;
  const SYNC_KEYS = ['tronos_db_v4', 'tronos_pre_v4', 'tronos_folders_v4'];

  let syncInProgress = false;
  let syncPending = false;
  let lastSyncTime = 0;
  const MIN_SYNC_INTERVAL = 1000;

  const pendingDeletes = {
    services:      new Set(),
    folders:       new Set(),
    preprogrammed: new Set()
  };

  const KEY_TO_CATEGORY = {
    'tronos_db_v4':      'services',
    'tronos_folders_v4': 'folders',
    'tronos_pre_v4':     'preprogrammed'
  };

  const originalSetItem = Storage.prototype.setItem;

  Storage.prototype.setItem = function(key, value) {
    if (SYNC_KEYS.includes(key)) {
      try {
        const oldArr = JSON.parse(localStorage.getItem(key) || '[]');
        const newArr = JSON.parse(value);
        if (Array.isArray(oldArr) && Array.isArray(newArr)) {
          const category = KEY_TO_CATEGORY[key];
          const newIds = new Set(newArr.map(item => String(item.id)));
          oldArr.forEach(item => { if (item.id != null && !newIds.has(String(item.id))) pendingDeletes[category].add(item.id); });
          newArr.forEach(item => { if (item.id != null) pendingDeletes[category].delete(item.id); });
        }
      } catch (e) {}
    }
    originalSetItem.call(this, key, value);
    if (SYNC_KEYS.includes(key)) debouncedSync();
  };

  let syncTimeout = null;
  function debouncedSync() {
    if (syncTimeout) clearTimeout(syncTimeout);
    syncTimeout = setTimeout(syncToServer, 500);
  }

  async function syncToServer() {
    if (syncInProgress) { syncPending = true; return; }
    const now = Date.now();
    if (now - lastSyncTime < MIN_SYNC_INTERVAL) {
      syncPending = true;
      setTimeout(() => { if (syncPending) { syncPending = false; syncToServer(); } }, MIN_SYNC_INTERVAL);
      return;
    }
    if (typeof state === 'undefined') return;

    syncInProgress = true;
    syncPending = false;
    lastSyncTime = now;

    const deletedIdsSnapshot = {
      services:      Array.from(pendingDeletes.services),
      folders:       Array.from(pendingDeletes.folders),
      preprogrammed: Array.from(pendingDeletes.preprogrammed)
    };

    try {
      const response = await fetch(API_URL + '/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          database:      state.database      || [],
          preprogrammed: state.preprogrammed || [],
          folders:       state.folders       || [],
          deletedIds:    deletedIdsSnapshot
        })
      });

      if (response.ok) {
        deletedIdsSnapshot.services.forEach(id      => pendingDeletes.services.delete(id));
        deletedIdsSnapshot.folders.forEach(id       => pendingDeletes.folders.delete(id));
        deletedIdsSnapshot.preprogrammed.forEach(id => pendingDeletes.preprogrammed.delete(id));
        console.log('Sincronizacion exitosa con MySQL');
      } else {
        console.error('Error de sincronizacion:', await response.text());
      }
    } catch (error) {
      console.error('Error de conexion:', error.message);
    } finally {
      syncInProgress = false;
      if (syncPending) { syncPending = false; setTimeout(syncToServer, 300); }
    }
  }

  async function loadStateFromServer(isAutoPull = false) {
    if (isAutoPull) {
      if (typeof state === 'undefined') return;
      if (state.editingId !== null || state.convertData !== null) return;
      if (state.view === 'programar') return;
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'SELECT' || activeEl.tagName === 'TEXTAREA')) return;
      if (document.querySelector('.fixed.inset-0')) return;
    }
    try {
      const response = await fetch(API_URL + '/api/state', { headers: { 'Accept': 'application/json' } });
      if (!response.ok) return;
      const data = await response.json();

      const serverHasData = (data.database && data.database.length > 0) ||
                            (data.preprogrammed && data.preprogrammed.length > 0) ||
                            (data.folders && data.folders.length > 0);
      const localHasData = JSON.parse(localStorage.getItem('tronos_db_v4')||'[]').length > 0 ||
                           JSON.parse(localStorage.getItem('tronos_pre_v4')||'[]').length > 0 ||
                           JSON.parse(localStorage.getItem('tronos_folders_v4')||'[]').length > 0;

      if (serverHasData) {
        if (isAutoPull && typeof state !== 'undefined') {
          const same = JSON.stringify(data.database||[]) === JSON.stringify(state.database||[]) &&
                       JSON.stringify(data.preprogrammed||[]) === JSON.stringify(state.preprogrammed||[]) &&
                       JSON.stringify(data.folders||[]) === JSON.stringify(state.folders||[]);
          if (same) return;
        }
        originalSetItem.call(localStorage, 'tronos_db_v4',      JSON.stringify(data.database      || []));
        originalSetItem.call(localStorage, 'tronos_pre_v4',     JSON.stringify(data.preprogrammed || []));
        originalSetItem.call(localStorage, 'tronos_folders_v4', JSON.stringify(data.folders       || []));
        if (typeof state !== 'undefined') {
          state.database = data.database || [];
          state.preprogrammed = data.preprogrammed || [];
          state.folders = data.folders || [];
        }
        if (typeof render === 'function') render();
      } else if (localHasData && !isAutoPull) {
        await syncToServer();
      }
    } catch (error) {
      if (!isAutoPull && typeof showToast === 'function') showToast('Modo offline - Usando almacenamiento local');
    }
  }

  function init() {
    if (typeof state === 'undefined' || typeof render !== 'function') { setTimeout(init, 150); return; }
    loadStateFromServer();
    setInterval(() => { if (document.visibilityState === 'visible') loadStateFromServer(true); }, 30000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') loadStateFromServer(true); });
    window.addEventListener('focus', () => loadStateFromServer(true));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 200));
  } else {
    setTimeout(init, 200);
  }

})();/**
 * =========================================================================
 * TRONOS DATABASE ADAPTER (MySQL Integration) - v3.0
 * =========================================================================
 * FIX v3: Se agrego tracking de pendingDeletes para detectar automaticamente
 * que IDs fueron eliminados por el usuario (comparando estado viejo vs nuevo
 * en localStorage). Estos IDs se envian al servidor como deletedIds para
 * que el endpoint /api/sync pueda borrarlos explicitamente sin afectar los
 * registros creados por otros usuarios concurrentes.
 */

(function() {
  'use strict';

  const API_URL = window.location.origin;
  const SYNC_KEYS = ['tronos_db_v4', 'tronos_pre_v4', 'tronos_folders_v4'];

  let syncInProgress = false;
  let syncPending = false;
  let lastSyncTime = 0;
  const MIN_SYNC_INTERVAL = 1000;

  // Tracking de eliminaciones por categoria
  const pendingDeletes = {
    services:      new Set(),
    folders:       new Set(),
    preprogrammed: new Set()
  };

  const KEY_TO_CATEGORY = {
    'tronos_db_v4':      'services',
    'tronos_folders_v4': 'folders',
    'tronos_pre_v4':     'preprogrammed'
  };

  // =====================================================================
  // 1. INTERCEPTAR localStorage.setItem para detectar guardados Y borrados
  // =====================================================================
  const originalSetItem = Storage.prototype.setItem;

  Storage.prototype.setItem = function(key, value) {
    // Detectar IDs eliminados ANTES de escribir (comparando viejo vs nuevo)
    if (SYNC_KEYS.includes(key)) {
      try {
        const oldArr = JSON.parse(localStorage.getItem(key) || '[]');
        const newArr = JSON.parse(value);

        if (Array.isArray(oldArr) && Array.isArray(newArr)) {
          const category = KEY_TO_CATEGORY[key];
          const newIds = new Set(newArr.map(item => String(item.id)));

          oldArr.forEach(item => {
            if (item.id != null && !newIds.has(String(item.id))) {
              pendingDeletes[category].add(item.id);
            }
          });

          newArr.forEach(item => {
            if (item.id != null) {
              pendingDeletes[category].delete(item.id);
            }
          });
        }
      } catch (e) {}
    }

    originalSetItem.call(this, key, value);

    if (SYNC_KEYS.includes(key)) {
      debouncedSync();
    }
  };

  // =====================================================================
  // 2. SINCRONIZACION CON EL SERVIDOR (PUSH)
  // =====================================================================
  let syncTimeout = null;

  function debouncedSync() {
    if (syncTimeout) clearTimeout(syncTimeout);
    syncTimeout = setTimeout(() => { syncToServer(); }, 500);
  }

  async function syncToServer() {
    if (syncInProgress) { syncPending = true; return; }

    const now = Date.now();
    if (now - lastSyncTime < MIN_SYNC_INTERVAL) {
      syncPending = true;
      setTimeout(() => { if (syncPending) { syncPending = false; syncToServer(); } }, MIN_SYNC_INTERVAL);
      return;
    }

    if (typeof state === 'undefined') {
      console.warn('No se puede sincronizar: state no esta definido.');
      return;
    }

    syncInProgress = true;
    syncPending = false;
    lastSyncTime = now;

    const deletedIdsSnapshot = {
      services:      Array.from(pendingDeletes.services),
      folders:       Array.from(pendingDeletes.folders),
      preprogrammed: Array.from(pendingDeletes.preprogrammed)
    };

    try {
      const databaseData      = state.database      || [];
      const preprogrammedData = state.preprogrammed || [];
      const foldersData       = state.folders       || [];

      const totalDeletes = deletedIdsSnapshot.services.length + deletedIdsSnapshot.folders.length + deletedIdsSnapshot.preprogrammed.length;
      console.log('Sincronizando: ' + databaseData.length + ' servicios, ' + preprogrammedData.length + ' pre, ' + foldersData.length + ' carpetas' + (totalDeletes > 0 ? ', ' + totalDeletes + ' eliminacion(es)' : ''));

      const response = await fetch(API_URL + '/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          database:      databaseData,
          preprogrammed: preprogrammedData,
          folders:       foldersData,
          deletedIds:    deletedIdsSnapshot
        })
      });

      if (response.ok) {
        deletedIdsSnapshot.services.forEach(id      => pendingDeletes.services.delete(id));
        deletedIdsSnapshot.folders.forEach(id       => pendingDeletes.folders.delete(id));
        deletedIdsSnapshot.preprogrammed.forEach(id => pendingDeletes.preprogrammed.delete(id));
        console.log('Sincronizacion exitosa con MySQL');
      } else {
        const errText = await response.text();
        console.error('Error de sincronizacion:', errText);
      }
    } catch (error) {
      console.error('Error de conexion al sincronizar:', error.message);
    } finally {
      syncInProgress = false;
      if (syncPending) { syncPending = false; setTimeout(syncToServer, 300); }
    }
  }

  // =====================================================================
  // 3. CARGAR DATOS DEL SERVIDOR (PULL)
  // =====================================================================
  async function loadStateFromServer(isAutoPull = false) {
    if (isAutoPull) {
      if (typeof state === 'undefined') return;
      if (state.editingId !== null || state.convertData !== null) return;
      if (state.view === 'programar') return;
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'SELECT' || activeEl.tagName === 'TEXTAREA')) return;
      if (document.querySelector('.fixed.inset-0')) return;
    }

    try {
      const response = await fetch(API_URL + '/api/state', { headers: { 'Accept': 'application/json' } });
      if (!response.ok) { console.error('Error al obtener estado:', response.status); return; }

      const data = await response.json();

      const serverHasData = (data.database && data.database.length > 0) ||
                            (data.preprogrammed && data.preprogrammed.length > 0) ||
                            (data.folders && data.folders.length > 0);

      const localDB      = JSON.parse(localStorage.getItem('tronos_db_v4')      || '[]');
      const localPre     = JSON.parse(localStorage.getItem('tronos_pre_v4')     || '[]');
      const localFolders = JSON.parse(localStorage.getItem('tronos_folders_v4') || '[]');
      const localHasData = localDB.length > 0 || localPre.length > 0 || localFolders.length > 0;

      if (serverHasData) {
        if (isAutoPull && typeof state !== 'undefined') {
          const same = JSON.stringify(data.database||[]) === JSON.stringify(state.database||[]) &&
                       JSON.stringify(data.preprogrammed||[]) === JSON.stringify(state.preprogrammed||[]) &&
                       JSON.stringify(data.folders||[]) === JSON.stringify(state.folders||[]);
          if (same) return;
          console.log('Nuevos datos detectados en la nube! Actualizando...');
        }

        originalSetItem.call(localStorage, 'tronos_db_v4',      JSON.stringify(data.database      || []));
        originalSetItem.call(localStorage, 'tronos_pre_v4',     JSON.stringify(data.preprogrammed || []));
        originalSetItem.call(localStorage, 'tronos_folders_v4', JSON.stringify(data.folders       || []));

        if (typeof state !== 'undefined') {
          state.database      = data.database      || [];
          state.preprogrammed = data.preprogrammed || [];
          state.folders       = data.folders       || [];
        }

        if (typeof render === 'function') render();

      } else if (localHasData && !isAutoPull) {
        console.log('Servidor vacio. Subiendo datos locales...');
        await syncToServer();
      }
    } catch (error) {
      if (!isAutoPull) {
        console.error('No se pudo conectar al servidor:', error.message);
        if (typeof showToast === 'function') showToast('Modo offline - Usando almacenamiento local');
      }
    }
  }

  // =====================================================================
  // 4. INICIALIZAR
  // =====================================================================
  function init() {
    if (typeof state === 'undefined' || typeof render !== 'function') {
      setTimeout(init, 150);
      return;
    }

    loadStateFromServer();

    setInterval(() => { if (document.visibilityState === 'visible') loadStateFromServer(true); }, 30000);

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') loadStateFromServer(true);
    });

    window.addEventListener('focus', () => { loadStateFromServer(true); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 200));
  } else {
    setTimeout(init, 200);
  }

})();/**
 * =========================================================================
 * TRONOS DATABASE ADAPTER (MySQL Integration) - v2.2
 * =========================================================================
 * Sincroniza automáticamente los datos entre localStorage (offline) y la
 * base de datos MySQL en el servidor (online). 
 *
 * NOTA DE DISEÑO: En index.html la variable 'state' está declarada con 'let',
 * lo que significa que es una variable de scope global pero NO pertenece al
 * objeto 'window'. Por ello, accedemos a ella directamente como 'state'
 * en lugar de 'window.state'.
 */

(function() {
  'use strict';

  const API_URL = window.location.origin;
  const SYNC_KEYS = ['tronos_db_v4', 'tronos_pre_v4', 'tronos_folders_v4'];
  
  let syncInProgress = false;
  let syncPending = false;
  let lastSyncTime = 0;
  const MIN_SYNC_INTERVAL = 1000; // Mínimo 1 segundo entre syncs

  // =====================================================================
  // 1. INTERCEPTAR localStorage.setItem para detectar guardados
  // =====================================================================
  const originalSetItem = Storage.prototype.setItem;
  
  Storage.prototype.setItem = function(key, value) {
    // Llamar al original primero (mantener localStorage funcional)
    originalSetItem.call(this, key, value);
    
    // Si la clave es una de las de TRONOS, sincronizar con el servidor
    if (SYNC_KEYS.includes(key)) {
      debouncedSync();
    }
  };

  // =====================================================================
  // 2. SINCRONIZACIÓN CON EL SERVIDOR (PUSH)
  // =====================================================================
  let syncTimeout = null;
  
  function debouncedSync() {
    if (syncTimeout) clearTimeout(syncTimeout);
    syncTimeout = setTimeout(() => {
      syncToServer();
    }, 500); // Esperar 500ms de "silencio" antes de sincronizar
  }

  async function syncToServer() {
    // Evitar syncs simultáneos
    if (syncInProgress) {
      syncPending = true;
      return;
    }
    
    // Rate limiting
    const now = Date.now();
    if (now - lastSyncTime < MIN_SYNC_INTERVAL) {
      syncPending = true;
      setTimeout(() => {
        if (syncPending) {
          syncPending = false;
          syncToServer();
        }
      }, MIN_SYNC_INTERVAL);
      return;
    }
    
    // Verificar que 'state' esté disponible antes de sincronizar
    if (typeof state === 'undefined') {
      console.warn('⚠️ No se puede sincronizar: "state" no está definido aún.');
      return;
    }
    
    syncInProgress = true;
    syncPending = false;
    lastSyncTime = now;

    try {
      // Leer los datos actuales del estado en memoria
      const databaseData = state.database || [];
      const preprogrammedData = state.preprogrammed || [];
      const foldersData = state.folders || [];

      console.log(`🔄 Sincronizando con servidor (Push): ${databaseData.length} servicios, ${preprogrammedData.length} pre-registros, ${foldersData.length} carpetas`);

      const response = await fetch(`${API_URL}/api/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          database: databaseData, 
          preprogrammed: preprogrammedData, 
          folders: foldersData 
        })
      });

      if (response.ok) {
        console.log('✅ Sincronización exitosa con MySQL');
      } else {
        const errText = await response.text();
        console.error('❌ Error de sincronización:', errText);
      }
    } catch (error) {
      console.error('❌ Error de conexión al sincronizar:', error.message);
    } finally {
      syncInProgress = false;
      
      // Si hubo un sync pendiente mientras estábamos sincronizando, ejecutar ahora
      if (syncPending) {
        syncPending = false;
        setTimeout(syncToServer, 300);
      }
    }
  }

  // =====================================================================
  // 3. CARGAR DATOS DEL SERVIDOR (PULL)
  // =====================================================================
  async function loadStateFromServer(isAutoPull = false) {
    // Si es auto-pull periódico, verificar si es seguro interrumpir al usuario
    if (isAutoPull) {
      if (typeof state === 'undefined') return;
      
      // 1. No sincronizar si está editando un registro, o pre-programando, o convirtiendo
      if (state.editingId !== null || state.convertData !== null) {
        console.log('ℹ️ Auto-sincronización pausada: El usuario está editando un formulario.');
        return;
      }
      
      // 2. No sincronizar si está en una vista de formulario activo (programar)
      if (state.view === 'programar') {
        return;
      }

      // 3. No sincronizar si hay algún input, select o textarea enfocado actualmente
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'SELECT' || activeEl.tagName === 'TEXTAREA')) {
        console.log('ℹ️ Auto-sincronización pausada: El usuario está escribiendo o interactuando con un control.');
        return;
      }

      // 4. No sincronizar si hay un modal de confirmación o alerta en pantalla
      if (document.querySelector('.fixed.inset-0')) {
        console.log('ℹ️ Auto-sincronización pausada: Hay un modal abierto.');
        return;
      }
    }

    try {
      if (!isAutoPull) {
        console.log('🔄 Conectando con la base de datos MySQL en:', API_URL);
      }
      
      const response = await fetch(`${API_URL}/api/state`, {
        headers: { 'Accept': 'application/json' }
      });

      if (!response.ok) {
        console.error('❌ Error al obtener estado del servidor:', response.status, response.statusText);
        return;
      }

      const data = await response.json();

      // Verificar si el servidor tiene datos
      const serverHasData = (data.database && data.database.length > 0) ||
                            (data.preprogrammed && data.preprogrammed.length > 0) ||
                            (data.folders && data.folders.length > 0);

      // Verificar si el localStorage local tiene datos
      const localDB = JSON.parse(localStorage.getItem('tronos_db_v4') || '[]');
      const localPre = JSON.parse(localStorage.getItem('tronos_pre_v4') || '[]');
      const localFolders = JSON.parse(localStorage.getItem('tronos_folders_v4') || '[]');
      const localHasData = localDB.length > 0 || localPre.length > 0 || localFolders.length > 0;

      if (serverHasData) {
        // Si es auto-pull, verificar si los datos realmente cambiaron antes de re-renderizar
        if (isAutoPull && typeof state !== 'undefined') {
          const dbStr = JSON.stringify(data.database || []);
          const preStr = JSON.stringify(data.preprogrammed || []);
          const fldStr = JSON.stringify(data.folders || []);
          
          const currentDbStr = JSON.stringify(state.database || []);
          const currentPreStr = JSON.stringify(state.preprogrammed || []);
          const currentFldStr = JSON.stringify(state.folders || []);
          
          if (dbStr === currentDbStr && preStr === currentPreStr && fldStr === currentFldStr) {
            // No hay cambios reales, no molestamos al DOM
            return;
          }
          console.log('🔔 ¡Nuevos datos detectados en la nube! Actualizando interfaz...');
        } else {
          console.log('📥 Cargando datos del servidor:', 
            data.database.length, 'servicios,',
            data.preprogrammed.length, 'pre-registros,',
            data.folders.length, 'carpetas'
          );
        }

        // Guardar en localStorage SIN disparar el sync de vuelta
        originalSetItem.call(localStorage, 'tronos_db_v4', JSON.stringify(data.database || []));
        originalSetItem.call(localStorage, 'tronos_pre_v4', JSON.stringify(data.preprogrammed || []));
        originalSetItem.call(localStorage, 'tronos_folders_v4', JSON.stringify(data.folders || []));

        // Actualizar el estado en memoria de la aplicación
        if (typeof state !== 'undefined') {
          state.database = data.database || [];
          state.preprogrammed = data.preprogrammed || [];
          state.folders = data.folders || [];
        }

        // Re-renderizar la interfaz
        if (typeof render === 'function') {
          render();
        }

        if (!isAutoPull) {
          console.log('✅ Datos cargados correctamente desde MySQL');
        }
      } else if (localHasData && !isAutoPull) {
        // El servidor está vacío pero hay datos locales y es la carga inicial → Subir locales
        console.log('📤 El servidor está vacío. Subiendo datos locales al servidor...');
        await syncToServer();
        console.log('✅ Datos locales sincronizados al servidor');
      } else if (!isAutoPull) {
        console.log('ℹ️ Sin datos en servidor ni en local. Base de datos vacía.');
      }
    } catch (error) {
      if (!isAutoPull) {
        console.error('❌ No se pudo conectar al servidor:', error.message);
        if (typeof showToast === 'function') {
          showToast("Modo offline - Usando almacenamiento local");
        }
      }
    }
  }

  // =====================================================================
  // 4. INICIALIZAR Y CONFIGURAR EVENTOS Y TEMPORIZADORES
  // =====================================================================
  function init() {
    // Esperar a que las variables y funciones principales de la app estén disponibles
    if (typeof state === 'undefined' || typeof render !== 'function') {
      // Reintentar en 150ms si la app aún no ha inicializado
      setTimeout(init, 150);
      return;
    }
    
    // 1. Carga inicial desde el servidor
    loadStateFromServer();

    // 2. Configurar Auto-Pull periódico cada 30 segundos (sólo si la pestaña está activa)
    setInterval(() => {
      if (document.visibilityState === 'visible') {
        loadStateFromServer(true);
      }
    }, 30000);

    // 3. Configurar Pull instantáneo cuando el usuario regresa a la pestaña o enfoca la ventana
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        loadStateFromServer(true);
      }
    });

    window.addEventListener('focus', () => {
      loadStateFromServer(true);
    });
  }

  // Usar DOMContentLoaded + setTimeout para asegurar que todo esté cargado
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 200));
  } else {
    setTimeout(init, 200);
  }

})();
