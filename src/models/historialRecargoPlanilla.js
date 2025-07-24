const { Model, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  class HistorialRecargoPlanilla extends Model {
    // Método para obtener resumen del cambio
    getResumenCambio() {
      return {
        accion: this.accion,
        version: this.version_nueva,
        usuario: this.realizado_por_id,
        fecha: this.fecha_accion,
        campos: this.campos_modificados
      };
    }
  }

  HistorialRecargoPlanilla.init({
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false,
    },
    recargo_planilla_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'recargos_planillas',
        key: 'id'
      },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    accion: {
      type: DataTypes.ENUM('creacion', 'actualizacion', 'eliminacion', 'restauracion', 'aprobacion', 'rechazo'),
      allowNull: false,
      validate: {
        isIn: {
          args: [['creacion', 'actualizacion', 'eliminacion', 'restauracion', 'aprobacion', 'rechazo']],
          msg: 'La acción debe ser: creacion, actualizacion, eliminacion, restauracion, aprobacion o rechazo'
        }
      },
      comment: 'Tipo de acción realizada',
    },
    version_anterior: {
      type: DataTypes.INTEGER,
      allowNull: true,
      validate: {
        min: {
          args: [1],
          msg: 'La versión anterior debe ser mayor a 0'
        }
      },
      comment: 'Versión anterior del recargo',
    },
    version_nueva: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: {
        min: {
          args: [1],
          msg: 'La versión nueva debe ser mayor a 0'
        }
      },
      comment: 'Nueva versión del recargo',
    },
    datos_anteriores: {
      type: DataTypes.JSONB,
      allowNull: true,
      comment: 'Datos completos antes del cambio (formato JSON)',
    },
    datos_nuevos: {
      type: DataTypes.JSONB,
      allowNull: true,
      comment: 'Datos completos después del cambio (formato JSON)',
    },
    campos_modificados: {
      type: DataTypes.ARRAY(DataTypes.STRING),
      allowNull: true,
      comment: 'Lista de campos que fueron modificados',
    },
    motivo: {
      type: DataTypes.TEXT,
      allowNull: true,
      validate: {
        len: {
          args: [0, 1000],
          msg: 'El motivo no puede exceder 1000 caracteres'
        }
      },
      comment: 'Motivo o razón del cambio',
    },
    ip_usuario: {
      type: DataTypes.INET,
      allowNull: true,
      comment: 'Dirección IP del usuario que realizó la acción',
    },
    user_agent: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'User Agent del navegador',
    },
    realizado_por_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id'
      },
      comment: 'Usuario que realizó la acción',
    },
    fecha_accion: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      comment: 'Fecha y hora de la acción',
    },
  }, {
    sequelize,
    modelName: 'HistorialRecargoPlanilla',
    tableName: 'historial_recargos_planillas',
    underscored: true,
    timestamps: false, // No necesitamos timestamps automáticos
    indexes: [
      {
        fields: ['recargo_planilla_id'],
        name: 'idx_historial_recargo',
      },
      {
        fields: ['realizado_por_id'],
        name: 'idx_historial_usuario',
      },
      {
        fields: ['accion'],
        name: 'idx_historial_accion',
      },
      {
        fields: ['fecha_accion'],
        name: 'idx_historial_fecha',
      },
      {
        fields: ['version_nueva'],
        name: 'idx_historial_version',
      },
    ],
  });

  HistorialRecargoPlanilla.associate = (models) => {
    // Relación con recargo
    if (models.RecargoPlanilla) {
      HistorialRecargoPlanilla.belongsTo(models.RecargoPlanilla, {
        foreignKey: 'recargo_planilla_id',
        as: 'recargo',
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      });
    }

    // Relación de auditoría
    if (models.User) {
      HistorialRecargoPlanilla.belongsTo(models.User, {
        foreignKey: 'realizado_por_id',
        as: 'usuario'
      });
    }
  };

  return HistorialRecargoPlanilla;
};