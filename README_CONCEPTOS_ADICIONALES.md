# Integración Backend - Conceptos Adicionales

## Descripción General

Los **conceptos adicionales** son ajustes monetarios que se pueden aplicar a una liquidación de nómina. Estos pueden ser valores positivos (que se suman al total) o negativos (que se restan del total). Ejemplos incluyen: bonos por desempeño, descuentos por daños, ajustes diversos, etc.

## Estructura de Datos Frontend

El frontend envía los conceptos adicionales con la siguiente estructura:

```typescript
conceptos_adicionales: Array<{
  valor: number;        // Puede ser positivo o negativo
  observaciones: string; // Descripción del concepto
}>
```

## Opciones de Implementación Backend

### Opción 1: Campo JSON en la tabla liquidaciones (Recomendado)

#### Modificación de la tabla `liquidaciones`

```sql
-- Agregar columna JSON a la tabla existente
ALTER TABLE liquidaciones 
ADD COLUMN conceptos_adicionales JSON DEFAULT NULL;

-- Opcional: Agregar índice para búsquedas
CREATE INDEX idx_liquidaciones_conceptos_adicionales 
ON liquidaciones USING GIN ((conceptos_adicionales));
```

#### Ejemplo de datos almacenados

```json
[
  {
    "valor": 50000,
    "observaciones": "Bono por puntualidad"
  },
  {
    "valor": -25000,
    "observaciones": "Descuento por daño menor"
  },
  {
    "valor": 100000,
    "observaciones": "Incentivo por desempeño mensual"
  }
]
```

#### Ventajas
- ✅ Implementación más simple
- ✅ Menos cambios en la estructura de base de datos
- ✅ Flexible para agregar campos adicionales en el futuro
- ✅ Ideal para datos que no requieren consultas complejas

#### Desventajas
- ❌ Consultas más complejas para reportes específicos
- ❌ Menos normalizado

---

### Opción 2: Tabla relacional separada

#### Crear nueva tabla `conceptos_adicionales`

```sql
CREATE TABLE conceptos_adicionales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  liquidacion_id UUID NOT NULL,
  valor DECIMAL(15,2) NOT NULL,
  observaciones TEXT NOT NULL,
  tipo_concepto VARCHAR(50) DEFAULT 'ajuste_general',
  creado_por_id UUID,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  CONSTRAINT fk_conceptos_liquidacion 
    FOREIGN KEY (liquidacion_id) 
    REFERENCES liquidaciones(id) 
    ON DELETE CASCADE,
    
  CONSTRAINT fk_conceptos_creado_por 
    FOREIGN KEY (creado_por_id) 
    REFERENCES users(id) 
    ON DELETE SET NULL,
    
  CONSTRAINT chk_valor_no_cero 
    CHECK (valor != 0),
    
  CONSTRAINT chk_observaciones_no_vacio 
    CHECK (LENGTH(TRIM(observaciones)) > 0)
);

-- Índices para optimizar consultas
CREATE INDEX idx_conceptos_adicionales_liquidacion_id 
ON conceptos_adicionales(liquidacion_id);

CREATE INDEX idx_conceptos_adicionales_tipo 
ON conceptos_adicionales(tipo_concepto);

CREATE INDEX idx_conceptos_adicionales_created_at 
ON conceptos_adicionales(created_at);
```

#### Ventajas
- ✅ Estructura más normalizada
- ✅ Facilita consultas y reportes complejos
- ✅ Permite auditoría individual por concepto
- ✅ Escalable para agregar más campos específicos

#### Desventajas
- ❌ Mayor complejidad en las consultas
- ❌ Más tablas para mantener

---

## Estructura del Payload que Recibe el Backend

Independientemente de la opción elegida, el backend debe esperar recibir:

```json
{
  "id": "liquidacion-uuid",
  "conductor_id": "conductor-uuid",
  "periodo_start": "2024-01-01",
  "periodo_end": "2024-01-31",
  // ... otros campos de liquidación ...
  "conceptos_adicionales": [
    {
      "valor": 50000,
      "observaciones": "Bono por puntualidad perfecta"
    },
    {
      "valor": -15000,
      "observaciones": "Descuento por combustible adicional"
    },
    {
      "valor": 75000,
      "observaciones": "Incentivo por metas alcanzadas"
    }
  ]
  // ... resto de campos ...
}
```

## Validaciones Requeridas

### Validaciones de Negocio

```javascript
// Pseudocódigo de validaciones
function validarConceptosAdicionales(conceptos) {
  if (!Array.isArray(conceptos)) {
    throw new Error("conceptos_adicionales debe ser un array");
  }
  
  conceptos.forEach((concepto, index) => {
    // Validar valor
    if (typeof concepto.valor !== 'number') {
      throw new Error(`Concepto ${index + 1}: valor debe ser un número`);
    }
    
    if (concepto.valor === 0) {
      throw new Error(`Concepto ${index + 1}: valor no puede ser cero`);
    }
    
    if (Math.abs(concepto.valor) > 10000000) { // 10 millones
      throw new Error(`Concepto ${index + 1}: valor excede el límite permitido`);
    }
    
    // Validar observaciones
    if (!concepto.observaciones || typeof concepto.observaciones !== 'string') {
      throw new Error(`Concepto ${index + 1}: observaciones es requerido`);
    }
    
    if (concepto.observaciones.trim().length < 3) {
      throw new Error(`Concepto ${index + 1}: observaciones debe tener al menos 3 caracteres`);
    }
    
    if (concepto.observaciones.length > 500) {
      throw new Error(`Concepto ${index + 1}: observaciones no puede exceder 500 caracteres`);
    }
  });
  
  // Validar límite de conceptos
  if (conceptos.length > 20) {
    throw new Error("No se pueden agregar más de 20 conceptos adicionales por liquidación");
  }
  
  return true;
}
```

### Schema de Validación (Joi/Yup)

```javascript
const conceptoAdicionalSchema = Joi.object({
  valor: Joi.number()
    .required()
    .not(0)
    .min(-10000000)
    .max(10000000)
    .messages({
      'number.base': 'El valor debe ser un número',
      'any.required': 'El valor es requerido',
      'number.min': 'El valor no puede ser menor a -10,000,000',
      'number.max': 'El valor no puede ser mayor a 10,000,000',
      'any.invalid': 'El valor no puede ser cero'
    }),
    
  observaciones: Joi.string()
    .required()
    .trim()
    .min(3)
    .max(500)
    .messages({
      'string.base': 'Las observaciones deben ser texto',
      'any.required': 'Las observaciones son requeridas',
      'string.min': 'Las observaciones deben tener al menos 3 caracteres',
      'string.max': 'Las observaciones no pueden exceder 500 caracteres'
    })
});

const conceptosAdicionalesSchema = Joi.array()
  .items(conceptoAdicionalSchema)
  .max(20)
  .messages({
    'array.max': 'No se pueden agregar más de 20 conceptos adicionales'
  });
```

## Cálculo de Totales

El frontend calcula el total de conceptos adicionales así:

```javascript
const totalAjustesAdicionales = conceptosAdicionales.reduce(
  (total, ajuste) => total + ajuste.valor,
  0
);

// Se suma al sueldo bruto (puede ser negativo)
const sueldoBruto = 
  salarioDevengado +
  auxilioTransporte +
  totalBonificaciones +
  totalPernotes +
  totalRecargos +
  totalVacaciones +
  bonificacionVillanueva +
  valorIncapacidad +
  interesCesantias +
  totalAjustesAdicionales; // ← Aquí se incluyen
```

## Endpoints Requeridos

### POST/PUT `/api/liquidaciones`
- Debe procesar el array `conceptos_adicionales`
- Aplicar todas las validaciones mencionadas
- Almacenar según la opción elegida (JSON o tabla relacional)

### GET `/api/liquidaciones/:id`
- Debe incluir los conceptos adicionales en la respuesta
- Formato de respuesta debe coincidir con el esperado por el frontend

### Ejemplo de respuesta esperada:
```json
{
  "id": "liquidacion-uuid",
  "conductor_id": "conductor-uuid",
  // ... otros campos ...
  "conceptos_adicionales": [
    {
      "valor": 50000,
      "observaciones": "Bono por puntualidad"
    }
  ]
  // ... resto de campos ...
}
```

## Consideraciones de Auditoría

Si se requiere auditoría detallada, considerar agregar:

```sql
-- Para la opción de tabla relacional
ALTER TABLE conceptos_adicionales ADD COLUMN version INTEGER DEFAULT 1;
ALTER TABLE conceptos_adicionales ADD COLUMN motivo_cambio TEXT;
ALTER TABLE conceptos_adicionales ADD COLUMN valor_anterior DECIMAL(15,2);

-- Tabla de auditoría
CREATE TABLE conceptos_adicionales_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  concepto_id UUID,
  accion VARCHAR(10), -- 'INSERT', 'UPDATE', 'DELETE'
  valor_anterior DECIMAL(15,2),
  valor_nuevo DECIMAL(15,2),
  observaciones_anterior TEXT,
  observaciones_nuevas TEXT,
  usuario_id UUID,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## Recomendación Final

**Se recomienda la Opción 1 (campo JSON)** para este caso de uso porque:

1. Los conceptos adicionales son datos semi-estructurados simples
2. No se requieren consultas complejas sobre conceptos individuales
3. Simplifica el desarrollo y mantenimiento
4. Es más eficiente para este volumen de datos
5. Coincide con la estructura que ya maneja el frontend

La implementación con JSON es suficiente para la mayoría de casos de uso de nómina donde los conceptos adicionales son principalmente para ajustes manuales ocasionales.