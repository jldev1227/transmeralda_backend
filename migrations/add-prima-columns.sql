-- Script SQL para agregar columnas prima y prima_pendiente
-- Fecha: 30 de enero de 2026
-- Autor: Sistema de Nómina Transmeralda

-- ============================================
-- 1. Agregar columna prima (si no existe)
-- ============================================
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name='liquidaciones' 
        AND column_name='prima'
    ) THEN
        ALTER TABLE liquidaciones 
        ADD COLUMN prima DECIMAL(10, 2) NOT NULL DEFAULT 0;
        
        COMMENT ON COLUMN liquidaciones.prima IS 'Valor de prima correspondiente al saldo pendiente del mes anterior';
        
        RAISE NOTICE 'Columna prima agregada exitosamente';
    ELSE
        RAISE NOTICE 'La columna prima ya existe, no se realizó ningún cambio';
    END IF;
END $$;

-- ============================================
-- 2. Agregar columna prima_pendiente
-- ============================================
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name='liquidaciones' 
        AND column_name='prima_pendiente'
    ) THEN
        ALTER TABLE liquidaciones 
        ADD COLUMN prima_pendiente DECIMAL(10, 2) NULL DEFAULT NULL;
        
        COMMENT ON COLUMN liquidaciones.prima_pendiente IS 'Valor pendiente de prima por pagar (opcional)';
        
        RAISE NOTICE 'Columna prima_pendiente agregada exitosamente';
    ELSE
        RAISE NOTICE 'La columna prima_pendiente ya existe, no se realizó ningún cambio';
    END IF;
END $$;

-- ============================================
-- 3. Verificar la estructura
-- ============================================
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default,
    col_description((table_schema||'.'||table_name)::regclass::oid, ordinal_position) as column_comment
FROM information_schema.columns
WHERE table_name = 'liquidaciones'
  AND column_name IN ('prima', 'prima_pendiente')
ORDER BY ordinal_position;

-- ============================================
-- Resultado esperado:
-- ============================================
-- column_name      | data_type | is_nullable | column_default | column_comment
-- -----------------+-----------+-------------+----------------+------------------------------------------
-- prima            | numeric   | NO          | 0              | Valor de prima correspondiente al saldo...
-- prima_pendiente  | numeric   | YES         | NULL           | Valor pendiente de prima por pagar...
