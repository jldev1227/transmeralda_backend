-- Migración: Adicionar campos de condiciones, riesgos y evaluación a recargos_planillas
-- Fecha: 26-01-2026
-- Descripción: Integración con servicios y campos de evaluación de condiciones de vía

-- 1. Adicionar relación con servicios
ALTER TABLE recargos_planillas
ADD COLUMN servicio_id UUID REFERENCES servicios(id) ON DELETE SET NULL;

-- 2. Adicionar estado del conductor
ALTER TABLE recargos_planillas
ADD COLUMN estado_conductor VARCHAR(20) CHECK (estado_conductor IN ('optimo', 'fatigado', 'regular', 'malo'));

-- 3. Adicionar condiciones de vía (tipo de terreno)
ALTER TABLE recargos_planillas
ADD COLUMN via_trocha BOOLEAN DEFAULT FALSE,
ADD COLUMN via_afirmado BOOLEAN DEFAULT FALSE,
ADD COLUMN via_mixto BOOLEAN DEFAULT FALSE,
ADD COLUMN via_pavimentada BOOLEAN DEFAULT FALSE;

-- 4. Adicionar riesgos de seguridad
ALTER TABLE recargos_planillas
ADD COLUMN riesgo_desniveles BOOLEAN DEFAULT FALSE,
ADD COLUMN riesgo_deslizamientos BOOLEAN DEFAULT FALSE,
ADD COLUMN riesgo_sin_senalizacion BOOLEAN DEFAULT FALSE,
ADD COLUMN riesgo_animales BOOLEAN DEFAULT FALSE,
ADD COLUMN riesgo_peatones BOOLEAN DEFAULT FALSE,
ADD COLUMN riesgo_trafico_alto BOOLEAN DEFAULT FALSE;

-- 5. Adicionar campos de evaluación
ALTER TABLE recargos_planillas
ADD COLUMN fuente_consulta VARCHAR(20) CHECK (fuente_consulta IN ('conductor', 'gps', 'cliente', 'sistema')),
ADD COLUMN calificacion_servicio VARCHAR(20) CHECK (calificacion_servicio IN ('excelente', 'bueno', 'regular', 'malo'));

-- 6. Adicionar métricas de tiempo
ALTER TABLE recargos_planillas
ADD COLUMN tiempo_disponibilidad_horas DECIMAL(5, 1),
ADD COLUMN duracion_trayecto_horas DECIMAL(5, 1),
ADD COLUMN numero_dias_servicio INTEGER;

-- 7. Crear índices para mejorar rendimiento
CREATE INDEX idx_recargos_servicio_id ON recargos_planillas(servicio_id);
CREATE INDEX idx_recargos_estado_conductor ON recargos_planillas(estado_conductor);
CREATE INDEX idx_recargos_calificacion ON recargos_planillas(calificacion_servicio);

-- 8. Comentarios para documentación
COMMENT ON COLUMN recargos_planillas.servicio_id IS 'Relación con el servicio que generó este recargo';
COMMENT ON COLUMN recargos_planillas.estado_conductor IS 'Estado físico/mental del conductor durante el servicio';
COMMENT ON COLUMN recargos_planillas.via_trocha IS 'Indica si se transitó por caminos de tierra sin mejoras';
COMMENT ON COLUMN recargos_planillas.via_afirmado IS 'Indica si se transitó por caminos con grava/piedra';
COMMENT ON COLUMN recargos_planillas.via_mixto IS 'Indica si se transitó por combinación de terrenos';
COMMENT ON COLUMN recargos_planillas.via_pavimentada IS 'Indica si se transitó por vías completamente pavimentadas';
COMMENT ON COLUMN recargos_planillas.riesgo_desniveles IS 'Presencia de desniveles peligrosos en la ruta';
COMMENT ON COLUMN recargos_planillas.riesgo_deslizamientos IS 'Zonas propensas a derrumbes en la ruta';
COMMENT ON COLUMN recargos_planillas.riesgo_sin_senalizacion IS 'Falta de señales de tránsito en la ruta';
COMMENT ON COLUMN recargos_planillas.riesgo_animales IS 'Presencia de ganado/animales en la vía';
COMMENT ON COLUMN recargos_planillas.riesgo_peatones IS 'Alto tráfico peatonal en la ruta';
COMMENT ON COLUMN recargos_planillas.riesgo_trafico_alto IS 'Congestión vehicular en la ruta';
COMMENT ON COLUMN recargos_planillas.fuente_consulta IS 'Fuente de donde se obtuvo la información del recargo';
COMMENT ON COLUMN recargos_planillas.calificacion_servicio IS 'Calificación general del servicio ejecutado';
COMMENT ON COLUMN recargos_planillas.tiempo_disponibilidad_horas IS 'Horas de disponibilidad/standby del conductor';
COMMENT ON COLUMN recargos_planillas.duracion_trayecto_horas IS 'Tiempo real de conducción ida y vuelta';
COMMENT ON COLUMN recargos_planillas.numero_dias_servicio IS 'Duración total del servicio en días';
