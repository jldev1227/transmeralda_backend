-- Migración: Agregar campos kilometraje_inicial y kilometraje_final
-- Fecha: 09-12-2025
-- Descripción: Añade columnas para registrar el kilometraje inicial y final
--              de cada día laboral en la tabla dias_laborales_planillas

-- ============================================
-- AGREGAR COLUMNAS
-- ============================================

-- Agregar columna kilometraje_inicial
ALTER TABLE dias_laborales_planillas 
ADD COLUMN kilometraje_inicial DECIMAL(10, 2) DEFAULT NULL;

COMMENT ON COLUMN dias_laborales_planillas.kilometraje_inicial IS 
'Kilometraje inicial del vehículo al inicio del día laboral';

-- Agregar columna kilometraje_final
ALTER TABLE dias_laborales_planillas 
ADD COLUMN kilometraje_final DECIMAL(10, 2) DEFAULT NULL;

COMMENT ON COLUMN dias_laborales_planillas.kilometraje_final IS 
'Kilometraje final del vehículo al final del día laboral';

-- ============================================
-- CREAR ÍNDICES PARA OPTIMIZAR BÚSQUEDAS
-- ============================================

CREATE INDEX idx_dia_laboral_km_inicial 
ON dias_laborales_planillas(kilometraje_inicial);

CREATE INDEX idx_dia_laboral_km_final 
ON dias_laborales_planillas(kilometraje_final);

-- ============================================
-- VERIFICAR CAMBIOS
-- ============================================

-- Ver estructura de la tabla
SELECT 
    column_name,
    data_type,
    character_maximum_length,
    column_default,
    is_nullable
FROM information_schema.columns
WHERE table_name = 'dias_laborales_planillas'
AND column_name IN ('kilometraje_inicial', 'kilometraje_final')
ORDER BY ordinal_position;

-- Ver índices creados
SELECT 
    indexname,
    indexdef
FROM pg_indexes
WHERE tablename = 'dias_laborales_planillas'
AND indexname LIKE '%km%';

-- ============================================
-- ROLLBACK (en caso de necesitar revertir)
-- ============================================

/*
-- Eliminar índices
DROP INDEX IF EXISTS idx_dia_laboral_km_inicial;
DROP INDEX IF EXISTS idx_dia_laboral_km_final;

-- Eliminar columnas
ALTER TABLE dias_laborales_planillas DROP COLUMN IF EXISTS kilometraje_inicial;
ALTER TABLE dias_laborales_planillas DROP COLUMN IF EXISTS kilometraje_final;
*/
