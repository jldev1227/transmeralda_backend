const { Model, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  class TipoRecargo extends Model {
    // Calcular valor de recargo basado en valor hora
    calcularValorRecargo(valorHoraTrabajador, horas) {
      if (this.es_valor_fijo) {
        return this.valor_fijo * horas;
      }
      return (valorHoraTrabajador * this.porcentaje / 100) * horas;
    }

    // Verificar si aplica según condiciones
    aplicaParaDia(esFestivo, esDomingo, esNocturno, esDiurno) {
      if (this.aplica_festivos !== null && this.aplica_festivos !== esFestivo) return false;
      if (this.aplica_domingos !== null && this.aplica_domingos !== esDomingo) return false;
      if (this.aplica_nocturno !== null && this.aplica_nocturno !== esNocturno) return false;
      if (this.aplica_diurno !== null && this.aplica_diurno !== esDiurno) return false;
      return true;
    }
  }

  TipoRecargo.init({
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false,
    },
    codigo: {
      type: DataTypes.STRING(20),
      allowNull: false,
      unique: true,
      validate: {
        is: {
          args: /^[A-Z_]+$/,
          msg: 'El código solo puede contener letras mayúsculas y guiones bajos'
        }
      },
      comment: 'Código único del tipo de recargo (ej: HED, HEN, RN)',
    },
    nombre: {
      type: DataTypes.STRING(100),
      allowNull: false,
      comment: 'Nombre descriptivo del tipo de recargo',
    },
    descripcion: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: 'Descripción detallada del tipo de recargo',
    },
    categoria: {
      type: DataTypes.ENUM(
        'HORAS_EXTRAS',
        'RECARGOS',
        'FESTIVOS',
        'SEGURIDAD_SOCIAL',
        'PRESTACIONES',
        'OTROS'
      ),
      allowNull: false,
      comment: 'Categoría del tipo de recargo',
    },
    subcategoria: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: 'Subcategoría específica (ej: DIURNAS, NOCTURNAS)',
    },
    porcentaje: {
      type: DataTypes.DECIMAL(8, 4),
      defaultValue: 0,
      allowNull: false,
      validate: {
        min: {
          args: [0],
          msg: 'El porcentaje no puede ser negativo'
        }
      },
      comment: 'Porcentaje de recargo sobre valor hora',
    },
    es_valor_fijo: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      allowNull: false,
      comment: 'Indica si es un valor fijo en lugar de porcentaje',
    },
    valor_fijo: {
      type: DataTypes.DECIMAL(12, 2),
      defaultValue: 0,
      allowNull: true,
      comment: 'Valor fijo si no es porcentual',
    },
    adicional: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      allowNull: false,
      comment: 'Determina el método de cálculo de recargos: ' +
        'true = valor_hora + (valor_hora * porcentaje) [adicional], ' +
        'false = valor_hora * (1 + porcentaje) [multiplicativo]',
    },
    // Condiciones de aplicación
    aplica_festivos: {
      type: DataTypes.BOOLEAN,
      allowNull: true, // null = no importa
      comment: 'Si aplica en días festivos (null = no importa)',
    },
    aplica_domingos: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      comment: 'Si aplica en domingos (null = no importa)',
    },
    aplica_nocturno: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      comment: 'Si aplica en horario nocturno (null = no importa)',
    },
    aplica_diurno: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      comment: 'Si aplica en horario diurno (null = no importa)',
    },
    // Control de cálculo
    orden_calculo: {
      type: DataTypes.INTEGER,
      defaultValue: 1,
      allowNull: false,
      comment: 'Orden en que se debe calcular este recargo',
    },
    es_hora_extra: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      allowNull: false,
      comment: 'Indica si es una hora extra',
    },
    requiere_horas_extras: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      allowNull: false,
      comment: 'Si requiere que primero se agoten las horas ordinarias',
    },
    limite_horas_diarias: {
      type: DataTypes.DECIMAL(4, 2),
      allowNull: true,
      comment: 'Límite de horas diarias para este tipo (null = sin límite)',
    },
    activo: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      allowNull: false,
      comment: 'Estado activo del tipo de recargo',
    },
    vigencia_desde: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      comment: 'Fecha desde la cual es válido este tipo',
    },
    vigencia_hasta: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Fecha hasta la cual es válido (null = sin límite)',
    },
    creado_por_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id'
      },
    },
  }, {
    sequelize,
    modelName: 'TipoRecargo',
    tableName: 'tipos_recargos',
    underscored: true,
    timestamps: true,
    paranoid: true,
    indexes: [
      {
        fields: ['codigo'],
        unique: true,
        name: 'idx_tipo_recargo_codigo'
      },
      {
        fields: ['categoria', 'activo'],
        name: 'idx_tipo_recargo_categoria'
      },
      {
        fields: ['orden_calculo', 'activo'],
        name: 'idx_tipo_recargo_orden'
      },
      {
        fields: ['adicional'],
        name: 'idx_tipo_recargo_adicional'
      },
    ]
  });

  TipoRecargo.associate = (models) => {
    if (models.DetalleRecargosDia) {
      TipoRecargo.hasMany(models.DetalleRecargosDia, {
        foreignKey: 'tipo_recargo_id',
        as: 'detallesRecargos'
      });
    }
    if (models.Usuario) {
      TipoRecargo.belongsTo(models.Usuario, {
        foreignKey: 'creado_por_id',
        as: 'creadoPor'
      });
    }
  };

  return TipoRecargo;
};