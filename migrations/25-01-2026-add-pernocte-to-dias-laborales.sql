-- Agregar columna pernocte a dias_laborales_planillas
-- Fecha: 25-01-2026
-- Descripción: Adiciona campo boolean para indicar si hubo pernocte en el día laboral

ALTER TABLE dias_laborales_planillas
ADD COLUMN pernocte BOOLEAN DEFAULT FALSE;

-- Crear índice para consultas por pernocte
CREATE INDEX idx_dias_laborales_pernocte ON dias_laborales_planillas(pernocte);

COMMENT ON COLUMN dias_laborales_planillas.pernocte IS 'Indica si el día laboral incluyó pernocte (quedarse a dormir fuera)';
