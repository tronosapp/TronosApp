-- ==========================================
-- SCRIPT DE CREACIÓN DE BASE DE DATOS TRONOS (MYSQL)
-- ==========================================

CREATE DATABASE IF NOT EXISTS tronos_db
CHARACTER SET utf8mb4
COLLATE utf8mb4_unicode_ci;

USE tronos_db;

-- 1. Tabla de Carpetas / Rutas
CREATE TABLE IF NOT EXISTS folders (
    id BIGINT PRIMARY KEY,
    nombre VARCHAR(255) NOT NULL,
    fecha VARCHAR(50) NOT NULL,
    ruta VARCHAR(255) DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_folders_fecha (fecha)
) ENGINE=InnoDB;

-- 2. Tabla de Pre-programación (Lista de Espera)
CREATE TABLE IF NOT EXISTS preprogrammed (
    id BIGINT PRIMARY KEY,
    fecha VARCHAR(50) DEFAULT NULL,
    pago VARCHAR(50) NOT NULL DEFAULT 'Efectivo',
    cliente VARCHAR(255) NOT NULL,
    contacto VARCHAR(255) DEFAULT NULL,
    origen VARCHAR(50) DEFAULT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'PRE',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_preprogrammed_fecha (fecha),
    INDEX idx_preprogrammed_cliente (cliente)
) ENGINE=InnoDB;

-- 3. Tabla de Servicios Programados (Base de Datos General)
CREATE TABLE IF NOT EXISTS services (
    id BIGINT PRIMARY KEY,
    type VARCHAR(50) NOT NULL, -- 'EVENTO', 'ENTREGAS DE OBRA', 'RETIROS DE OBRA', 'MOVIMIENTO'
    fecha VARCHAR(50) NOT NULL,
    pago VARCHAR(50) NOT NULL,
    vendedor VARCHAR(50) DEFAULT NULL,
    cot VARCHAR(100) DEFAULT NULL,
    tipo_mov VARCHAR(100) DEFAULT NULL,
    motivo VARCHAR(100) DEFAULT NULL,
    cliente VARCHAR(255) NOT NULL,
    contacto VARCHAR(255) NOT NULL,
    origen VARCHAR(50) DEFAULT NULL,
    obra VARCHAR(255) DEFAULT NULL,
    cont_contrata VARCHAR(255) DEFAULT NULL,
    direccion TEXT NOT NULL,
    ubicacion TEXT DEFAULT NULL,
    
    -- Logística de Evento
    h_e VARCHAR(20) DEFAULT NULL,
    h_e_m VARCHAR(20) DEFAULT NULL,
    f_r VARCHAR(50) DEFAULT NULL,
    h_r VARCHAR(20) DEFAULT NULL,
    h_r_m VARCHAR(20) DEFAULT NULL,
    
    status VARCHAR(50) NOT NULL DEFAULT 'PENDIENTE',
    
    -- Hitos/Checkboxes para Eventos
    chk_entrega TINYINT(1) NOT NULL DEFAULT 0,
    chk_limpieza TINYINT(1) NOT NULL DEFAULT 0,
    chk_retiro TINYINT(1) NOT NULL DEFAULT 0,
    
    -- Datos estructurados JSON para adicionales virtuales (Expansor Universal)
    extra_status JSON DEFAULT NULL,
    extra_folderId JSON DEFAULT NULL,
    extra_chk_entrega JSON DEFAULT NULL,
    extra_chk_limpieza JSON DEFAULT NULL,
    extra_chk_retiro JSON DEFAULT NULL,
    
    -- Asociación opcional a carpeta
    folderId BIGINT DEFAULT NULL,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (folderId) REFERENCES folders(id) ON DELETE SET NULL,
    INDEX idx_services_fecha (fecha),
    INDEX idx_services_type (type),
    INDEX idx_services_status (status),
    INDEX idx_services_cliente (cliente)
) ENGINE=InnoDB;

-- 4. Tabla de Sanitarios / Productos
CREATE TABLE IF NOT EXISTS products (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    service_id BIGINT NOT NULL,
    cant INT NOT NULL DEFAULT 1,
    modelo VARCHAR(100) NOT NULL, -- 'ESTANDAR', 'QUEEN', 'FLUSH', 'INCLUYENTE', 'LAVAMANOS'
    sym TINYINT(1) NOT NULL DEFAULT 0, -- 1 si tiene lámpara/candado, 0 si no
    n_dir TEXT DEFAULT NULL,
    n_cont VARCHAR(255) DEFAULT NULL,
    n_obra VARCHAR(255) DEFAULT NULL,
    n_ubi TEXT DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE,
    INDEX idx_products_service (service_id)
) ENGINE=InnoDB;

-- 5. Tabla de Limpiezas Intermedias (Eventos)
CREATE TABLE IF NOT EXISTS cleanings (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    service_id BIGINT NOT NULL,
    f_l VARCHAR(50) NOT NULL,
    h_l_d VARCHAR(20) DEFAULT NULL,
    h_l_a VARCHAR(20) DEFAULT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'PENDIENTE',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE,
    INDEX idx_cleanings_service (service_id)
) ENGINE=InnoDB;
