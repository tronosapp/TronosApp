/**
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
