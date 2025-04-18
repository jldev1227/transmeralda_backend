const { Model, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  class Servicio extends Model {
    // Método para serializar el servicio
    toJSON() {
      const values = { ...this.get() };
      return values;
    }
  }

  Servicio.init({
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    origen_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'municipios',
        key: 'id'
      },
      validate: {
        notNull: { msg: 'El origen es obligatorio' },
        notEmpty: { msg: 'El origen no puede estar vacío' }
      }
    },
    destino_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'municipios',
        key: 'id'
      },
      validate: {
        notNull: { msg: 'El destino es obligatorio' },
        notEmpty: { msg: 'El destino no puede estar vacío' }
      }
    },
    origen_especifico: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        notNull: { msg: 'El origen específico es obligatorio' },
        notEmpty: { msg: 'El origen específico no puede estar vacío' }
      }
    },
    destino_especifico: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        notNull: { msg: 'El destino específico es obligatorio' },
        notEmpty: { msg: 'El destino específico no puede estar vacío' }
      }
    },
    conductor_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'users', // Asumiendo que tienes una tabla de usuarios para conductores
        key: 'id'
      },
      validate: {
        notNull: { msg: 'El conductor es obligatorio' },
        notEmpty: { msg: 'El conductor no puede estar vacío' }
      }
    },
    vehiculo_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'vehiculos', // Asumiendo que tienes una tabla de vehículos
        key: 'id'
      },
      validate: {
        notNull: { msg: 'El vehículo es obligatorio' },
        isInt: { msg: 'El ID del vehículo debe ser un número entero' }
      }
    },
    cliente_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'empresas', // Asumiendo que tienes una tabla de empresas
        key: 'id'
      },
      validate: {
        notNull: { msg: 'El cliente es obligatorio' },
        isInt: { msg: 'El ID del cliente debe ser un número entero' }
      }
    },
    estado: {
      type: DataTypes.ENUM('EN CURSO', 'COMPLETADO', 'PENDIENTE', 'REALIZADO', 'CANCELADO'),
      allowNull: false,
      defaultValue: 'PENDIENTE',
      validate: {
        notNull: { msg: 'El estado es obligatorio' },
        isIn: {
          args: [['EN CURSO', 'COMPLETADO', 'PENDIENTE', 'REALIZADO', 'CANCELADO']],
          msg: 'Estado no válido'
        }
      }
    },
    tipo_servicio: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        notNull: { msg: 'El tipo de servicio es obligatorio' },
        notEmpty: { msg: 'El tipo de servicio no puede estar vacío' }
      }
    },
    fecha_inicio: {
      type: DataTypes.DATE,
      allowNull: false,
      validate: {
        notNull: { msg: 'La fecha de inicio es obligatoria' },
        isDate: { msg: 'Debe ser una fecha válida' }
      }
    },
    fecha_fin: {
      type: DataTypes.DATE,
      allowNull: true,
      validate: {
        isDate: { msg: 'Debe ser una fecha válida' }
      }
    },
    distancia_km: {
      type: DataTypes.FLOAT,
      allowNull: false,
      validate: {
        notNull: { msg: 'La distancia es obligatoria' },
        isFloat: { msg: 'La distancia debe ser un número' },
        min: {
          args: [0],
          msg: 'La distancia no puede ser negativa'
        }
      }
    },
    valor: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      validate: {
        notNull: { msg: 'El valor es obligatorio' },
        isDecimal: { msg: 'El valor debe ser un número decimal' },
        min: {
          args: [0],
          msg: 'El valor no puede ser negativo'
        }
      }
    },
    observaciones: {
      type: DataTypes.TEXT,
      allowNull: true
    }
  }, {
    sequelize,
    modelName: 'Servicio',
    tableName: 'servicios',
    underscored: true, // Usar snake_case en la base de datos
    timestamps: true, // Habilita created_at y updated_at
    hooks: {
      beforeValidate: (servicio) => {
        // Puedes agregar lógica adicional aquí, como cálculos automáticos
        // Por ejemplo, calcular la distancia o el valor basado en origen y destino
      }
    }
  });

  // Definir las asociaciones cuando se inicialice el modelo
  Servicio.associate = (models) => {
    // Relaciones con otros modelos
    Servicio.belongsTo(models.Municipio, { 
      as: 'origen',
      foreignKey: 'origen_id'
    });
    
    Servicio.belongsTo(models.Municipio, { 
      as: 'destino',
      foreignKey: 'destino_id'
    });
    
    Servicio.belongsTo(models.User, { 
      as: 'conductor',
      foreignKey: 'conductor_id'
    });
    
    // Asumiendo que tienes estos modelos
    Servicio.belongsTo(models.Vehiculo, { 
      as: 'vehiculo',
      foreignKey: 'vehiculo_id'
    });
    
    Servicio.belongsTo(models.Empresa, { 
      as: 'cliente',
      foreignKey: 'cliente_id'
    });
  };
  
  return Servicio;
};