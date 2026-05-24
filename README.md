# 🪑 TRONOS - Sistema de Gestión de Programación

Sistema integral para la gestión y programación de servicios de sanitarios portátiles.

## 🚀 Características

- **Programación de Eventos** — Gestión completa de entregas, limpiezas y retiros
- **Pre-programación** — Lista de espera para clientes pendientes
- **Base de Datos MySQL** — Almacenamiento robusto y escalable
- **Exportación** — Genera reportes en PDF y Excel
- **Interfaz Moderna** — Diseño responsivo y fácil de usar

## 📋 Requisitos

- [Node.js](https://nodejs.org/) v18 o superior
- [XAMPP](https://www.apachefriends.org/) (MySQL en puerto 3306)

## ⚡ Instalación Rápida

```bash
# 1. Clonar el repositorio
git clone https://github.com/tronosapp/TronosApp.git
cd TronosApp

# 2. Instalar dependencias
npm install

# 3. Configurar variables de entorno
cp .env.example .env
# Editar .env con tus credenciales de MySQL

# 4. Crear la base de datos
mysql -u root < database/schema.sql

# 5. Iniciar el servidor
npm start
```

## 🌐 Acceso

Una vez iniciado, abre tu navegador en: **http://localhost:3000**

## 📁 Estructura del Proyecto

```
TronosApp/
├── public/
│   ├── index.html        # Interfaz web principal
│   └── db_adapter.js     # Adaptador de sincronización con DB
├── database/
│   └── schema.sql        # Esquema de base de datos MySQL
├── server.js             # Backend Node.js + Express
├── package.json          # Dependencias del proyecto
├── .env.example          # Plantilla de configuración
└── README.md             # Este archivo
```

## 🗄️ Base de Datos

| Tabla | Descripción |
|-------|-------------|
| `folders` | Carpetas/Rutas de programación |
| `services` | Servicios programados (eventos, entregas, retiros) |
| `products` | Sanitarios y productos asignados |
| `cleanings` | Limpiezas intermedias de eventos |
| `preprogrammed` | Lista de espera / pre-programación |

## 📄 Licencia

© 2026 TRONOS. Todos los derechos reservados.
