// src/models/recargoPlanilla.js
const { Model, DataTypes } = require('sequelize');


module.exports = (sequelize) => {
  const crearRegistroHistorial = async (recargo, options) => {
    try {
      const camposIgnorados = ['updated_at', 'version'];
      const cambiosReales = recargo.changed()?.filter(
        campo => !camposIgnorados.includes(campo)
      ) || [];

      if (cambiosReales.length === 0) {
        console.log('⏭️  No hay cambios relevantes, omitiendo historial');
        return;
      }

      const datosAnteriores = {};
      const datosNuevos = {};
      const camposModificados = [];

      cambiosReales.forEach(campo => {
        const valorAnterior = recargo._previousDataValues[campo];
        const valorNuevo = recargo.dataValues[campo];

        if (JSON.stringify(valorAnterior) !== JSON.stringify(valorNuevo)) {
          datosAnteriores[campo] = valorAnterior;
          datosNuevos[campo] = valorNuevo;
          camposModificados.push(campo);
        }
      });

      if (camposModificados.length === 0) return;

      await sequelize.models.HistorialRecargoPlanilla.create({
        recargo_planilla_id: recargo.id,
        accion: 'actualizacion',
        version_anterior: recargo.version - 1,
        version_nueva: recargo.version,
        datos_anteriores: datosAnteriores,
        datos_nuevos: datosNuevos,
        campos_modificados: camposModificados,
        motivo: options.motivo || 'Actualización del recargo',
        realizado_por_id: options.userId || recargo.actualizado_por_id,
        ip_usuario: options.ipAddress || null,
        user_agent: options.userAgent || null,
        fecha_accion: new Date()
      }, { transaction: options.transaction });

      console.log(`📝 Historial registrado v${recargo.version}: ${camposModificados.join(', ')}`);

    } catch (error) {
      console.error('❌ Error creando historial:', error);
      // No lanzar error para no bloquear la actualización
    }
  };

  const crearSnapshot = async (recargo, options) => {
    try {
      // Cargar recargo completo con relaciones
      const recargoCompleto = await sequelize.models.RecargoPlanilla.findByPk(recargo.id, {
        include: [
          {
            model: sequelize.models.DiaLaboralPlanilla,
            as: 'dias_laborales',
            include: [{
              model: sequelize.models.DetalleRecargosDia,
              as: 'detallesRecargos',
              include: [{
                model: sequelize.models.TipoRecargo,
                as: 'tipoRecargo'
              }]
            }]
          },
          { model: sequelize.models.Conductor, as: 'conductor' },
          { model: sequelize.models.Vehiculo, as: 'vehiculo' },
          { model: sequelize.models.Empresa, as: 'empresa' }
        ],
        transaction: options.transaction
      });

      const snapshot = recargoCompleto.toJSON();
      const snapshotJSON = JSON.stringify(snapshot);
      const tamañoBytes = Buffer.byteLength(snapshotJSON, 'utf8');

      await sequelize.models.SnapshotRecargoPlanilla.create({
        recargo_planilla_id: recargo.id,
        version: recargo.version,
        snapshot_completo: snapshot,
        es_snapshot_mayor: options.esSnapshotMayor || recargo.version % 10 === 0,
        tipo_snapshot: options.tipoSnapshot || 'automatico',
        tamaño_bytes: tamañoBytes,
        creado_por_id: options.userId || recargo.actualizado_por_id
      }, { transaction: options.transaction });

      console.log(`📸 Snapshot creado v${recargo.version} (${(tamañoBytes / 1024).toFixed(2)} KB)`);

    } catch (error) {
      console.error('❌ Error creando snapshot:', error);
      // No lanzar error para no bloquear la actualización
    }
  };

  class RecargoPlanilla extends Model {
    // Métodos útiles del modelo

    // Verificar si el recargo es editable
    esEditable() {
      return this.estado === 'pendiente' || this.estado === 'liquidada';
    }
  }

  RecargoPlanilla.init({
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false,
    },

    // RELACIONES CON OTRAS ENTIDADES
    conductor_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'conductores',
        key: 'id'
      },
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE',
      comment: 'ID del conductor asociado al recargo',
    },

    vehiculo_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'vehiculos',
        key: 'id'
      },
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE',
      comment: 'ID del vehículo asociado al recargo',
    },

    empresa_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'empresas',
        key: 'id'
      },
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE',
      comment: 'ID de la empresa asociada al recargo',
    },

    // INFORMACIÓN BÁSICA DEL RECARGO
    numero_planilla: {
      type: DataTypes.STRING(50),
      allowNull: true,
      unique: true,
      validate: {
        len: {
          args: [0, 50],
          msg: 'El número de planilla no puede exceder 50 caracteres'
        }
      },
      comment: 'Número único de la planilla (ej: PL-2025-07-001)',
    },

    mes: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: {
        min: {
          args: [1],
          msg: 'El mes debe ser mayor a 0'
        },
        max: {
          args: [12],
          msg: 'El mes no puede ser mayor a 12'
        }
      },
      comment: 'Mes del recargo (1-12)',
    },

    año: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: {
        min: {
          args: [2000],
          msg: 'El año debe ser mayor a 2000'
        },
        max: {
          args: [2100],
          msg: 'El año no puede ser mayor a 2100'
        }
      },
      comment: 'Año del recargo',
    },

    // TOTALES CALCULADOS (se actualizan automáticamente)
    total_dias_laborados: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      validate: {
        min: {
          args: [0],
          msg: 'Los días laborados no pueden ser negativos'
        }
      },
      comment: 'Total de días laborados en el período',
    },

    total_horas_trabajadas: {
      type: DataTypes.DECIMAL(6, 1),
      defaultValue: 0,
      validate: {
        min: {
          args: [0],
          msg: 'Las horas trabajadas no pueden ser negativas'
        }
      },
      get() {
        const value = this.getDataValue('total_horas_trabajadas');
        return value === null ? 0 : parseFloat(value);
      },
      comment: 'Total de horas trabajadas en el período',
    },

    total_horas_ordinarias: {
      type: DataTypes.DECIMAL(6, 1),
      defaultValue: 0,
      validate: {
        min: {
          args: [0],
          msg: 'Las horas ordinarias no pueden ser negativas'
        }
      },
      get() {
        const value = this.getDataValue('total_horas_ordinarias');
        return value === null ? 0 : parseFloat(value);
      },
      comment: 'Total de horas ordinarias en el período',
    },

    planilla_s3key: {
      type: DataTypes.STRING,
      allowNull: true,
    },

    // INFORMACIÓN ADICIONAL
    observaciones: {
      type: DataTypes.TEXT,
      allowNull: true,
      validate: {
        len: {
          args: [0, 1000],
          msg: 'Las observaciones no pueden exceder 1000 caracteres'
        }
      },
      comment: 'Observaciones adicionales del recargo',
    },

    // CONTROL DE ESTADO
    estado: {
      type: DataTypes.ENUM('pendiente', 'liquidada', 'facturada'),
      defaultValue: 'pendiente',
      allowNull: false,
      comment: 'Estado actual del recargo',
    },

    version: {
      type: DataTypes.INTEGER,
      defaultValue: 1,
      allowNull: false,
      comment: 'Versión del recargo para control de cambios',
    },

    // AUDITORÍA
    creado_por_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id'
      },
      comment: 'ID del usuario que creó el recargo',
    },

    actualizado_por_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id'
      },
      comment: 'ID del usuario que actualizó el recargo por última vez',
    },

  }, {
    sequelize,
    modelName: 'RecargoPlanilla',
    tableName: 'recargos_planillas',
    underscored: true,
    timestamps: true,
    paranoid: true, // Soft deletes

    indexes: [],

    hooks: {
      beforeValidate: (recargo) => {
        if (recargo.observaciones !== null &&
          recargo.observaciones !== undefined &&
          recargo.observaciones.trim() === '') {
          recargo.observaciones = null;
        }
      },

      beforeUpdate: (recargo) => {
        if (recargo.changed() && !recargo.changed('version')) {
          recargo.version = (recargo.version || 1) + 1;
        }
      },

      afterCreate: async (recargo, options) => {
        try {
          console.log(`✅ Recargo planilla creado: ${recargo.numero_planilla}`);

          // Crear historial de creación
          await sequelize.models.HistorialRecargoPlanilla.create({
            recargo_planilla_id: recargo.id,
            accion: 'creacion',
            version_anterior: null,
            version_nueva: 1,
            datos_anteriores: null,
            datos_nuevos: {
              numero_planilla: recargo.numero_planilla,
              mes: recargo.mes,
              año: recargo.año,
              conductor_id: recargo.conductor_id,
              vehiculo_id: recargo.vehiculo_id,
              empresa_id: recargo.empresa_id,
              estado: recargo.estado
            },
            campos_modificados: null,
            motivo: options.motivo || 'Creación inicial del recargo',
            realizado_por_id: options.userId || recargo.creado_por_id,
            ip_usuario: options.ipAddress || null,
            user_agent: options.userAgent || null,
            fecha_accion: new Date()
          }, { transaction: options.transaction });

          // Crear snapshot inicial
          await crearSnapshot(recargo, {
            ...options,
            esSnapshotMayor: true,
            tipoSnapshot: 'automatico'
          });

        } catch (error) {
          console.error('❌ Error en afterCreate:', error);
        }
      },

      afterUpdate: async (recargo, options) => {
        try {
          // 1. Crear registro en historial
          await crearRegistroHistorial(recargo, options);

          console.log(`🔄 Recargo actualizado: ${recargo.numero_planilla} (v${recargo.version})`);

        } catch (error) {
          console.error('❌ Error en afterUpdate:', error);
        }
      },

      beforeDestroy: async (recargo) => {
        console.log(`🗑️  Eliminando recargo planilla: ${recargo.numero_planilla}`);
      }
    }
  });

  // Asociaciones
  RecargoPlanilla.associate = (models) => {
    // Relación con días laborales
    if (models.DiaLaboralPlanilla) {
      RecargoPlanilla.hasMany(models.DiaLaboralPlanilla, {
        foreignKey: 'recargo_planilla_id',
        as: 'dias_laborales',
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      });
    }

    // Relación con conductor
    if (models.Conductor) {
      RecargoPlanilla.belongsTo(models.Conductor, {
        foreignKey: 'conductor_id',
        as: 'conductor',
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
      });
    }

    // Relación con vehículo
    if (models.Vehiculo) {
      RecargoPlanilla.belongsTo(models.Vehiculo, {
        foreignKey: 'vehiculo_id',
        as: 'vehiculo',
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
      });
    }

    // Relación con empresa
    if (models.Empresa) {
      RecargoPlanilla.belongsTo(models.Empresa, {
        foreignKey: 'empresa_id',
        as: 'empresa',
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
      });
    }

    // Relación con historial
    if (models.HistorialRecargoPlanilla) {
      RecargoPlanilla.hasMany(models.HistorialRecargoPlanilla, {
        foreignKey: 'recargo_planilla_id',
        as: 'historial',
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      });
    }

    // Relación con users (auditoría)
    if (models.User) {
      RecargoPlanilla.belongsTo(models.User, {
        foreignKey: 'creado_por_id',
        as: 'creadoPor',
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      });

      RecargoPlanilla.belongsTo(models.User, {
        foreignKey: 'actualizado_por_id',
        as: 'actualizadoPor',
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      });
    }

    if (models.SnapshotRecargoPlanilla) {
      RecargoPlanilla.hasMany(models.SnapshotRecargoPlanilla, {
        foreignKey: 'recargo_planilla_id',
        as: 'snapshots',
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      });
    }
  };

  return RecargoPlanilla;
};