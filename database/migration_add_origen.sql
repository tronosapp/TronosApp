-- ==========================================
-- MIGRACIÓN: Agregar columna 'origen' (PREPROGRAMAR, EVENTOS, ENTREGAS DE OBRA)
-- Ejecutar sobre una base de datos tronos_db ya existente.
-- ==========================================

USE tronos_db;

ALTER TABLE preprogrammed ADD COLUMN origen VARCHAR(50) DEFAULT NULL;
ALTER TABLE services ADD COLUMN origen VARCHAR(50) DEFAULT NULL;
