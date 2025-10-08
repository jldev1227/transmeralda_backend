// src/models/snapshotRecargoPlanilla.js
const { Model, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  class SnapshotRecargoPlanilla extends Model {}

  SnapshotRecargoPlanilla.init({
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    recargo_planilla_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'recargos_planillas',
        key: 'id'
      },
      onDelete: 'CASCADE',
    },
    version: {
      type: DataTypes.INTEGER,
      allowNull: false,
      comment: 'Versión del recargo en este snapshot'
    },
    snapshot_completo: {
      type: DataTypes.JSONB,
      allowNull: false,
      comment: 'Estado completo: recargo + dias_laborales + detalles_recargos'
    },
    es_snapshot_mayor: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: 'true si es un snapshot importante (cada 10 versiones o cambio crítico)'
    },
    tipo_snapshot: {
      type: DataTypes.ENUM('automatico', 'manual', 'pre_aprobacion', 'pre_facturacion'),
      defaultValue: 'automatico',
      comment: 'Razón por la que se creó el snapshot'
    },
    tamaño_bytes: {
      type: DataTypes.INTEGER,
      comment: 'Tamaño del JSON para optimización'
    },
    creado_por_id: {
      type: DataTypes.UUID,
      references: { model: 'users', key: 'id' }
    }
  }, {
    sequelize,
    modelName: 'SnapshotRecargoPlanilla',
    tableName: 'snapshots_recargos_planillas',
    underscored: true,
    timestamps: true,
    updatedAt: false,
    indexes: [
      { fields: ['recargo_planilla_id', 'version'], unique: true },
      { fields: ['es_snapshot_mayor'] },
      { fields: ['tipo_snapshot'] }
    ]
  });

  SnapshotRecargoPlanilla.associate = (models) => {
    if (models.RecargoPlanilla) {
      SnapshotRecargoPlanilla.belongsTo(models.RecargoPlanilla, {
        foreignKey: 'recargo_planilla_id',
        as: 'recargo',
        onDelete: 'CASCADE',
      });
    }

    if (models.User) {
      SnapshotRecargoPlanilla.belongsTo(models.User, {
        foreignKey: 'creado_por_id',
        as: 'creadoPor'
      });
    }
  };

  return SnapshotRecargoPlanilla;
};