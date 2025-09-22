const { Model, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    class ServicioCancelado extends Model {
        // Método para serializar
        toJSON() {
            const values = { ...this.get() };
            return values;
        }
    }

    ServicioCancelado.init({
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
                notNull: { msg: 'El ID del servicio es obligatorio' },
                notEmpty: { msg: 'El ID del servicio no puede estar vacío' }
            }
        },
        usuario_cancelacion_id: {
            type: DataTypes.UUID,
            allowNull: false,
            references: {
                model: 'users', // Ajusta según tu tabla de users
                key: 'id'
            },
            validate: {
                notNull: { msg: 'El usuario que cancela es obligatorio' }
            }
        },
        motivo_cancelacion: {
            type: DataTypes.ENUM(
                'cliente_solicito',
                'conductor_no_disponible',
                'vehiculo_averiado',
                'vehiculo_no_disponible',
                'condiciones_climaticas',
                'problema_operativo',
                'falta_pago',
                'problemas_comunidad',
                'paro_via',
                'emergencia',
                'duplicado',
                'otro'
            ),

            allowNull: false,
            validate: {
                notNull: { msg: 'El motivo de cancelación es obligatorio' },
                isIn: {
                    args: [['cliente_solicito', 'conductor_no_disponible', 'vehiculo_averiado', 'condiciones_climaticas', 'falta_de_pago', 'duplicado', 'error_sistema', 'otro']],
                    msg: 'Motivo de cancelación no válido'
                }
            }
        },
        observaciones: {
            type: DataTypes.TEXT,
            allowNull: true
        },
        fecha_cancelacion: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW,
            dialectOptions: {
                timezone: false
            },
            validate: {
                notNull: { msg: 'La fecha de cancelación es obligatoria' },
                isDate: { msg: 'Debe ser una fecha válida' }
            }
        }
    }, {
        sequelize,
        modelName: 'ServicioCancelado',
        tableName: 'servicios_cancelados',
        underscored: true,
        timestamps: true,
        indexes: [
            {
                fields: ['servicio_id']
            },
            {
                fields: ['usuario_cancelacion_id']
            },
            {
                fields: ['fecha_cancelacion']
            }
        ]
    });

    // Definir las asociaciones
    ServicioCancelado.associate = (models) => {
        ServicioCancelado.belongsTo(models.Servicio, {
            as: 'servicio',
            foreignKey: 'servicio_id'
        });

        ServicioCancelado.belongsTo(models.User, { // Ajusta según tu modelo de usuario
            as: 'usuario_cancelacion',
            foreignKey: 'usuario_cancelacion_id'
        });
    };

    return ServicioCancelado;
};