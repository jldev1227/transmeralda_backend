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
        beforeValidate: (servicio) => {
          // Lógica existente...
        },
        
        // Registrar cambios después de actualizar un servicio
        afterUpdate: async (servicio, options) => {
          if (!options.user_id) return; // Si no hay ID de usuario, no registrar
          
          try {
            const changed = servicio.changed();
            if (!changed || changed.length === 0) return;
            
            const historicosToCreate = [];
            const ServicioHistorico = sequelize.models.ServicioHistorico;
            
            // Para cada campo modificado, crear un registro en el histórico
            for (const campo of changed) {
              // Ignorar campos que no queremos trackear como timestamps
              if (['updated_at', 'created_at'].includes(campo)) continue;
              
              historicosToCreate.push({
                servicio_id: servicio.id,
                usuario_id: options.user_id,
                campo_modificado: campo,
                valor_anterior: servicio.previous(campo)?.toString() || null,
                valor_nuevo: servicio.getDataValue(campo)?.toString() || null,
                tipo_operacion: 'actualizacion',
                ip_usuario: options.ip_usuario || null,
                navegador_usuario: options.navegador_usuario || null,
                detalles: options.detalles || null
              });
            }
            
            // Crear los registros del histórico
            if (historicosToCreate.length > 0) {
              await ServicioHistorico.bulkCreate(historicosToCreate);
            }
          } catch (error) {
            console.error('Error al registrar histórico:', error);
            // No lanzar error para no interrumpir la operación principal
          }
        },
        
        // Registrar creación de servicio
        afterCreate: async (servicio, options) => {
          if (!options.user_id) return;
          
          try {
            const ServicioHistorico = sequelize.models.ServicioHistorico;
            
            await ServicioHistorico.create({
              servicio_id: servicio.id,
              usuario_id: options.user_id,
              campo_modificado: 'creacion_servicio',
              valor_anterior: null,
              valor_nuevo: JSON.stringify(servicio.toJSON()),
              tipo_operacion: 'creacion',
              ip_usuario: options.ip_usuario || null,
              navegador_usuario: options.navegador_usuario || null,
              detalles: options.detalles || null
            });
          } catch (error) {
            console.error('Error al registrar histórico de creación:', error);
          }
        },
        
        // Registrar eliminación (si es softDelete) o eliminación física
        afterDestroy: async (servicio, options) => {
          if (!options.user_id) return;
          
          try {
            const ServicioHistorico = sequelize.models.ServicioHistorico;
            
            await ServicioHistorico.create({
              servicio_id: servicio.id,
              usuario_id: options.user_id,
              campo_modificado: 'eliminacion_servicio',
              valor_anterior: JSON.stringify(servicio.toJSON()),
              valor_nuevo: null,
              tipo_operacion: 'eliminacion',
              ip_usuario: options.ip_usuario || null,
              navegador_usuario: options.navegador_usuario || null,
              detalles: options.detalles || null
            });
          } catch (error) {
            console.error('Error al registrar histórico de eliminación:', error);
          }
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
        as: 'user',
        foreignKey: 'user_id'
      });
    } else {
      console.warn('Modelo User no encontrado. Asociación user en ServicioHistorico no creada.');
    }
  };
  
  return ServicioHistorico;
};