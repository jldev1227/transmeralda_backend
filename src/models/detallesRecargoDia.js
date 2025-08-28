// src/models/detalleRecargosDia.js

const { Model, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  class DetalleRecargosDia extends Model {

    // ===== MÉTODOS ÚTILES DEL MODELO =====

    /**
     * Calcular valor monetario del recargo
     */
    async calcularValor() {
      try {
        const tipoRecargo = await this.getTipoRecargo();
        const diaLaboral = await this.getDiaLaboral();
        const recargoPlanilla = await diaLaboral.getRecargoPlanilla();

        // Obtener configuración salarial de la empresa
        const configSalario = await sequelize.models.ConfiguracionSalario.findOne({
          where: {
            empresa_id: recargoPlanilla.empresa_id,
            activo: true
          }
        });

        if (!configSalario) {
          throw new Error('No se encontró configuración salarial para la empresa');
        }

        // Calcular valor según el tipo de recargo
        if (tipoRecargo.es_valor_fijo) {
          return parseFloat(tipoRecargo.valor_fijo) * parseFloat(this.horas);
        }

        const valorHora = parseFloat(configSalario.valor_hora_trabajador);
        const porcentajeRecargo = parseFloat(tipoRecargo.porcentaje) / 100;

        return valorHora * porcentajeRecargo * parseFloat(this.horas);

      } catch (error) {
        console.error('Error calculando valor del recargo:', error);
        return 0;
      }
    }

    /**
     * Verificar si el recargo es válido
     */
    esValido() {
      return this.horas > 0 && this.tipo_recargo_id && this.dia_laboral_id;
    }

    /**
     * Obtener descripción completa del recargo
     */
    async obtenerDescripcion() {
      const tipoRecargo = await this.getTipoRecargo();
      const diaLaboral = await this.getDiaLaboral();

      return `${tipoRecargo.nombre} - ${this.horas}h (Día ${diaLaboral.dia})`;
    }

    /**
     * Formatear horas para mostrar
     */
    get horasFormateadas() {
      const horas = parseFloat(this.horas);
      return horas % 1 === 0 ? horas.toString() : horas.toFixed(2);
    }

    /**
     * Método estático para crear múltiples recargos
     */
    static async crearMultiples(recargosData, transaction = null) {
      const opciones = transaction ? { transaction } : {};

      const recargosCreados = [];
      for (const recargoData of recargosData) {
        if (recargoData.horas > 0) {
          const recargo = await this.create(recargoData, opciones);
          recargosCreados.push(recargo);
        }
      }

      return recargosCreados;
    }

    /**
     * Método estático para obtener resumen por día
     */
    static async obtenerResumenPorDia(diaLaboralId) {
      const detalles = await this.findAll({
        where: { dia_laboral_id: diaLaboralId },
        include: [{
          model: sequelize.models.TipoRecargo,
          as: 'tipoRecargo',
          attributes: ['codigo', 'nombre', 'porcentaje']
        }]
      });

      const resumen = {};
      let totalHoras = 0;
      let valorTotal = 0;

      for (const detalle of detalles) {
        const codigo = detalle.tipoRecargo.codigo;
        const horas = parseFloat(detalle.horas);
        const valor = await detalle.calcularValor();

        resumen[codigo] = {
          horas,
          valor,
          porcentaje: detalle.tipoRecargo.porcentaje,
          nombre: detalle.tipoRecargo.nombre
        };

        totalHoras += horas;
        valorTotal += valor;
      }

      return {
        detalles: resumen,
        total_horas_recargo: totalHoras,
        valor_total: valorTotal
      };
    }
  }

  // ===== DEFINICIÓN DEL MODELO =====

  DetalleRecargosDia.init({
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false,
      comment: 'Identificador único del detalle de recargo'
    },

    dia_laboral_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'dias_laborales_planillas',
        key: 'id'
      },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
      comment: 'ID del día laboral asociado'
    },

    tipo_recargo_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'tipos_recargos',
        key: 'id'
      },
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE',
      comment: 'ID del tipo de recargo'
    },

    horas: {
      type: DataTypes.DECIMAL(6, 4),
      allowNull: false,
      defaultValue: 0,
      validate: {
        min: {
          args: [-24], // Permitir hasta -24 horas
          msg: 'Las horas no pueden ser menores a -24'
        },
        max: {
          args: [24],
          msg: 'Las horas no pueden exceder 24 en un día'
        }
      },
      get() {
        const value = this.getDataValue('horas');
        return value === null ? 0 : parseFloat(value);
      },
      set(value) {
        // Redondear a 4 decimales para evitar problemas de precisión
        this.setDataValue('horas', parseFloat(parseFloat(value).toFixed(4)));
      },
      comment: 'Cantidad de horas de este tipo de recargo (puede ser negativo para ajustes)'
    },
    valor_hora_base: {
      type: DataTypes.DECIMAL(12, 4),
      allowNull: true,
      validate: {
        min: {
          args: [0],
          msg: 'El valor hora base no puede ser negativo'
        }
      },
      get() {
        const value = this.getDataValue('valor_hora_base');
        return value === null ? null : parseFloat(value);
      },
      comment: 'Valor hora base usado para el cálculo (histórico)'
    },

    valor_calculado: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: true,
      validate: {
        min: {
          args: [0],
          msg: 'El valor calculado no puede ser negativo'
        }
      },
      get() {
        const value = this.getDataValue('valor_calculado');
        return value === null ? null : parseFloat(value);
      },
      comment: 'Valor monetario calculado (histórico)'
    },

    observaciones: {
      type: DataTypes.TEXT,
      allowNull: true,
      validate: {
        len: {
          args: [0, 500],
          msg: 'Las observaciones no pueden exceder 500 caracteres'
        }
      },
      comment: 'Observaciones específicas de este recargo'
    },

    calculado_automaticamente: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      allowNull: false,
      comment: 'Si fue calculado automáticamente o ingresado manualmente'
    },

    activo: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      allowNull: false,
      comment: 'Si el recargo está activo'
    },

    version: {
      type: DataTypes.INTEGER,
      defaultValue: 1,
      allowNull: false,
      comment: 'Versión del registro para control de cambios'
    },

    // ===== CAMPOS DE AUDITORÍA =====

    creado_por_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id'
      },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
      comment: 'ID del usuario que creó el registro'
    },

    actualizado_por_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id'
      },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
      comment: 'ID del usuario que actualizó el registro por última vez'
    }

  }, {
    sequelize,
    modelName: 'DetalleRecargosDia',
    tableName: 'detalles_recargos_dias',
    underscored: true,
    timestamps: true,
    paranoid: true, // Soft deletes

    // ===== ÍNDICES =====
    indexes: [
      {
        fields: ['dia_laboral_id', 'tipo_recargo_id'],
        unique: true,
        name: 'idx_detalle_recargo_dia_tipo',
        where: {
          deleted_at: null
        }
      },
      {
        fields: ['tipo_recargo_id'],
        name: 'idx_detalle_recargo_tipo'
      },
      {
        fields: ['dia_laboral_id'],
        name: 'idx_detalle_recargo_dia'
      },
      {
        fields: ['horas'],
        name: 'idx_detalle_recargo_horas'
      },
      {
        fields: ['calculado_automaticamente'],
        name: 'idx_detalle_recargo_automatico'
      },
      {
        fields: ['activo'],
        name: 'idx_detalle_recargo_activo'
      },
      {
        fields: ['created_at'],
        name: 'idx_detalle_recargo_created'
      }
    ],

    // ===== HOOKS =====
    hooks: {
      beforeValidate: (detalle) => {
        // Limpiar observaciones vacías
        if (detalle.observaciones && detalle.observaciones.trim() === '') {
          detalle.observaciones = null;
        }
      },

      beforeCreate: (detalle) => {
        // Establecer versión inicial
        detalle.version = 1;
      },

      beforeUpdate: (detalle) => {
        // Incrementar versión en cada actualización
        if (detalle.changed() && !detalle.changed('version')) {
          detalle.version = (detalle.version || 1) + 1;
        }
      },

      afterCreate: async (detalle) => {
        console.log(`✅ Detalle de recargo creado: ${detalle.horas}h (${detalle.id})`);
      },

      afterUpdate: async (detalle) => {
        console.log(`🔄 Detalle de recargo actualizado: ${detalle.horas}h (v${detalle.version})`);
      },

      beforeDestroy: async (detalle) => {
        console.log(`🗑️ Eliminando detalle de recargo: ${detalle.id}`);
      }
    },

    // ===== VALIDACIONES A NIVEL DE MODELO =====
    validate: {
      valoresConsistentes() {
        if (this.valor_hora_base && this.valor_calculado) {
          const valorEsperado = this.valor_hora_base * this.horas;
          const diferencia = Math.abs(valorEsperado - this.valor_calculado);

          if (diferencia > 0.01) { // Tolerancia de 1 centavo
            console.warn('Posible inconsistencia en valores calculados');
          }
        }
      }
    }
  });

  // ===== ASOCIACIONES =====

  DetalleRecargosDia.associate = (models) => {
    // Relación con DiaLaboralPlanilla
    if (models.DiaLaboralPlanilla) {
      DetalleRecargosDia.belongsTo(models.DiaLaboralPlanilla, {
        foreignKey: 'dia_laboral_id',
        as: 'diaLaboral',
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE'
      });
    }

    // Relación con TipoRecargo
    if (models.TipoRecargo) {
      DetalleRecargosDia.belongsTo(models.TipoRecargo, {
        foreignKey: 'tipo_recargo_id',
        as: 'tipoRecargo',
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE'
      });
    }

    // Relaciones de auditoría
    if (models.Usuario) {
      DetalleRecargosDia.belongsTo(models.Usuario, {
        foreignKey: 'creado_por_id',
        as: 'creadoPor',
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE'
      });

      DetalleRecargosDia.belongsTo(models.Usuario, {
        foreignKey: 'actualizado_por_id',
        as: 'actualizadoPor',
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE'
      });
    }
  };

  return DetalleRecargosDia;
};