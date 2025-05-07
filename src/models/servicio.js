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
      allowNull: true,
      references: {
        model: 'conductores', // Asumiendo que tienes una tabla de usuarios para conductores
        key: 'id'
      },
    },
    vehiculo_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'vehiculos', // Asumiendo que tienes una tabla de vehículos
        key: 'id'
      },
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
      }
    },
    estado: {
      type: DataTypes.ENUM('en_curso', 'pendiente', 'realizado', 'cancelado', 'planificado', 'solicitado', "planilla_asignada", "liquidado"),
      allowNull: false,
      defaultValue: 'solicitado',
      validate: {
        notNull: { msg: 'El estado es obligatorio' },
        isIn: {
          args: [['en_curso', 'pendiente', 'realizado', 'cancelado', 'planificado', 'solicitado', "planilla_asignada", "liquidado"]],
          msg: 'Estado no válido'
        }
      }
    },
    proposito_servicio: {
      type: DataTypes.ENUM('personal', 'personal y herramienta'),
      allowNull: false,
      defaultValue: 'personal',
      validate: {
        notNull: { msg: 'El proposito del servicio es obligatorio' },
        isIn: {
          args: [['personal', 'personal y herramienta']],
          msg: 'Proposito no válido'
        }
      }
    },
    fecha_solicitud: {
      type: DataTypes.DATE,
      allowNull: false,
      dialectOptions: {
        timezone: false
      },
      validate: {
        notNull: { msg: 'La fecha de solicitud es obligatoria' },
        isDate: { msg: 'Debe ser una fecha válida' }
      }
    },
    
    fecha_realizacion: {
      type: DataTypes.DATE,
      allowNull: true,
      dialectOptions: {
        timezone: false
      },
      validate: {
        isDate: { msg: 'Debe ser una fecha válida' }
      }
    },
    origen_latitud: {
      type: DataTypes.FLOAT,
      allowNull: true,
      validate: {
        isFloat: { msg: 'La latitud de origen debe ser un número' },
        min: {
          args: [-90],
          msg: 'La latitud debe estar entre -90 y 90'
        },
        max: {
          args: [90],
          msg: 'La latitud debe estar entre -90 y 90'
        }
      }
    },
    origen_longitud: {
      type: DataTypes.FLOAT,
      allowNull: true,
      validate: {
        isFloat: { msg: 'La longitud de origen debe ser un número' },
        min: {
          args: [-180],
          msg: 'La longitud debe estar entre -180 y 180'
        },
        max: {
          args: [180],
          msg: 'La longitud debe estar entre -180 y 180'
        }
      }
    },
    destino_latitud: {
      type: DataTypes.FLOAT,
      allowNull: true,
      validate: {
        isFloat: { msg: 'La latitud de destino debe ser un número' },
        min: {
          args: [-90],
          msg: 'La latitud debe estar entre -90 y 90'
        },
        max: {
          args: [90],
          msg: 'La latitud debe estar entre -90 y 90'
        }
      }
    },
    destino_longitud: {
      type: DataTypes.FLOAT,
      allowNull: true,
      validate: {
        isFloat: { msg: 'La longitud de destino debe ser un número' },
        min: {
          args: [-180],
          msg: 'La longitud debe estar entre -180 y 180'
        },
        max: {
          args: [180],
          msg: 'La longitud debe estar entre -180 y 180'
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
    numero_planilla: {
      type: DataTypes.STRING,
      allowNull: true,
      validate: {
        is: {
          args: /^TM-\d{1,5}$/,
          msg: 'El formato debe ser TM-XXXXX (donde X son dígitos, de 1 a 5 dígitos)'
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
      },
      
      // Registrar cambios después de actualizar un servicio
      afterUpdate: async (servicio, options) => {
        console.log('Servicio afterUpdate hook called with options:', JSON.stringify(options));
        console.log('Servicio ID:', servicio.id);
        
        if (!options.user_id) {
          console.log('No user_id provided in options, skipping historical record update');
          return;
        }
        
        try {
          const changed = servicio.changed();
          console.log('Changed fields:', changed);
          
          if (!changed || changed.length === 0) {
            console.log('No fields changed, skipping historical record update');
            return;
          }
          
          const historicosToCreate = [];
          const ServicioHistorico = sequelize.models.ServicioHistorico;
          
          // Para cada campo modificado, crear un registro en el histórico
          for (const campo of changed) {
            // Ignorar campos que no queremos trackear como timestamps
            if (['updated_at', 'created_at'].includes(campo)) {
              console.log(`Skipping timestamp field: ${campo}`);
              continue;
            }
            
            const valorAnterior = servicio.previous(campo)?.toString() || null;
            const valorNuevo = servicio.getDataValue(campo)?.toString() || null;
            
            console.log(`Field ${campo} changed from '${valorAnterior}' to '${valorNuevo}'`);
            
            historicosToCreate.push({
              servicio_id: servicio.id,
              usuario_id: options.user_id,
              campo_modificado: campo,
              valor_anterior: valorAnterior,
              valor_nuevo: valorNuevo,
              tipo_operacion: 'actualizacion',
              ip_usuario: options.ip_usuario || null,
              navegador_usuario: options.navegador_usuario || null,
              detalles: options.detalles || null
            });
          }
          
          // Crear los registros del histórico
          if (historicosToCreate.length > 0) {
            console.log(`Creating ${historicosToCreate.length} historical records for update`);
            const createdHistoricos = await ServicioHistorico.bulkCreate(historicosToCreate);
            console.log(`Created ${createdHistoricos.length} historical records successfully`);
          }
        } catch (error) {
          console.error('Error al registrar histórico:', error);
          // No lanzar error para no interrumpir la operación principal
        }
      },
      
      // Registrar creación de servicio
      afterCreate: async (servicio, options) => {
        console.log('Servicio afterCreate hook called with options:', JSON.stringify(options));
        console.log('Servicio ID:', servicio.id);
        
        if (!options.user_id) {
          console.log('No user_id provided in options, skipping historical record creation');
          return;
        }

        try {
          const ServicioHistorico = sequelize.models.ServicioHistorico;
          
          const historico = await ServicioHistorico.create({
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
          
          console.log('Histórico creado correctamente con ID:', historico.id);
        } catch (error) {
          console.error('Error al registrar histórico de creación:', error);
        }
      },
      
      // Registrar eliminación (si es softDelete) o eliminación física
      afterDestroy: async (servicio, options) => {
        console.log('Servicio afterDestroy hook called with options:', JSON.stringify(options));
        console.log('Servicio ID:', servicio.id);
        
        if (!options.user_id) {
          console.log('No user_id provided in options, skipping historical record for deletion');
          return;
        }
        
        try {
          const ServicioHistorico = sequelize.models.ServicioHistorico;
          
          const historico = await ServicioHistorico.create({
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
          
          console.log('Histórico de eliminación creado correctamente con ID:', historico.id);
        } catch (error) {
          console.error('Error al registrar histórico de eliminación:', error);
        }
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
    
    Servicio.belongsTo(models.Conductor, { 
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

    Servicio.belongsToMany(models.LiquidacionServicio, { 
      through: models.ServicioLiquidacion, 
      as: 'liquidaciones',
      foreignKey: 'servicio_id'
    });
  };
  
  return Servicio;
};