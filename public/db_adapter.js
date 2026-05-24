/**
 * =========================================================================
 * TRONOS DATABASE ADAPTER (MySQL Integration)
 * =========================================================================
 * Este script actúa como un puente entre la interfaz web de TRONOS y el 
 * servidor backend con MySQL.
 * 
 * INSTRUCCIONES DE USO:
 * Simplemente añade este script al final de tu archivo HTML (justo antes de 
 * cerrar la etiqueta </body> o dentro del script principal) para activar la
 * base de datos MySQL en producción de forma 100% transparente.
 */

// Utiliza la URL de origen actual del navegador automáticamente
const API_URL = window.location.origin;

// 1. Cargar el estado inicial desde MySQL
async function loadStateFromDb() {
  try {
    console.log('🔄 Conectando con la base de datos MySQL en:', API_URL);
    const response = await fetch(`${API_URL}/api/state`);
    
    if (response.ok) {
      const data = await response.json();
      
      // Actualizar el estado global de la aplicación
      if (window.state) {
        window.state.database = data.database || [];
        window.state.preprogrammed = data.preprogrammed || [];
        window.state.folders = data.folders || [];
        
        console.log('✅ Datos cargados correctamente desde MySQL');
        
        // Volver a renderizar la vista actual con los datos del servidor
        if (typeof window.render === 'function') {
          window.render();
        }
      } else {
        console.warn('⚠️ El objeto "state" no se ha inicializado aún.');
      }
    } else {
      console.error('❌ Error al obtener el estado desde el servidor:', response.statusText);
    }
  } catch (error) {
    console.error('❌ No se pudo conectar al servidor backend. Asegúrate de que el servidor esté ejecutándose.', error);
    if (typeof window.showToast === 'function') {
      window.showToast("Usando almacenamiento local de respaldo (Sin Conexión DB)");
    }
  }
}

// 2. Interceptar la función saveState original para sincronizar con MySQL
if (typeof window.saveState === 'function') {
  const originalSaveState = window.saveState;
  
  window.saveState = async function() {
    // Ejecutar primero el guardado local en localStorage como respaldo offline
    originalSaveState();
    
    // Sincronizar de inmediato con MySQL en segundo plano
    try {
      const response = await fetch(`${API_URL}/api/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          database: window.state.database,
          preprogrammed: window.state.preprogrammed,
          folders: window.state.folders
        })
      });
      
      if (response.ok) {
        console.log('💾 Sincronización exitosa con la base de datos MySQL');
      } else {
        const errText = await response.text();
        console.error('❌ Error de sincronización con la base de datos:', errText);
      }
    } catch (error) {
      console.error('❌ Error de conexión al sincronizar con el servidor:', error);
    }
  };
}

// 3. Inicializar la carga cuando el documento esté listo
document.addEventListener('DOMContentLoaded', () => {
  // Un retraso de 100ms asegura que las variables y funciones principales del HTML ya estén declaradas
  setTimeout(loadStateFromDb, 100);
});
