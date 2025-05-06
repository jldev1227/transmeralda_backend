const { Model, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  class ServicioHistorico extends Model {
    toJSON() {
      const values = { ...this.get() };
      return values;
    }
  }

  ServicioHistorico.init({
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    servicio_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'servicios',
        key: 'id'
      },
      validate: {
        notNull: { msg: 'El servicio es obligatorio' },
        notEmpty: { msg: 'El servicio no puede estar vacío' }
      }
    },
    usuario_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'users', // Asegúrate de que este modelo existe
        key: 'id'
      },
      validate: {
        notNull: { msg: 'El usuario es obligatorio' },
        notEmpty: { msg: 'El usuario no puede estar vacío' }
      }
    },
    campo_modificado: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        notNull: { msg: 'El campo modificado es obligatorio' },
        notEmpty: { msg: 'El campo modificado no puede estar vacío' }
      }
    },
    valor_anterior: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    valor_nuevo: {
      type: DataTypes.TEXT,
      allowNull: false,
      validate: {
        notNull: { msg: 'El valor nuevo es obligatorio' }
      }
    },
    tipo_operacion: {
      type: DataTypes.ENUM('creacion', 'actualizacion', 'eliminacion'),
      allowNull: false,
      defaultValue: 'actualizacion',
      validate: {
        notNull: { msg: 'El tipo de operación es obligatorio' },
        isIn: {
          args: [['creacion', 'actualizacion', 'eliminacion']],
          msg: 'Tipo de operación no válido'
        }
      }
    },
    fecha_modificacion: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      validate: {
        notNull: { msg: 'La fecha de modificación es obligatoria' },
        isDate: { msg: 'Debe ser una fecha válida' }
      }
    },
    ip_usuario: {
      type: DataTypes.STRING,
      allowNull: true
    },
    navegador_usuario: {
      type: DataTypes.STRING,
      allowNull: true
    },
    detalles: {
      type: DataTypes.JSONB, // Para almacenar información adicional
      allowNull: true
    }
  }, {
    sequelize,
    modelName: 'ServicioHistorico',
    tableName: 'servicio_historicos',
    underscored: true,
    timestamps: true,
    hooks: {
        beforeValidate: (historico) => {
          // Validación del histórico si es necesario
        }
      }
  });

  // Modificar la forma en que se definen las asociaciones para evitar errores
  ServicioHistorico.associate = (models) => {
    // Verificar que los modelos existan antes de crear las asociaciones
    if (models.Servicio) {
      ServicioHistorico.belongsTo(models.Servicio, {
        as: 'servicio',
        foreignKey: 'servicio_id'
      });
    }
    
    // Verificar si el modelo Usuario existe
    if (models.User) {
      ServicioHistorico.belongsTo(models.User, {
        as: 'usuario',
        foreignKey: 'usuario_id'
      });
    } else {
      console.warn('Modelo User no encontrado. Asociación usuario en ServicioHistorico no creada.');
    }
  };
  
  return ServicioHistorico;
};