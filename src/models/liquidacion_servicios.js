const { Model, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    class LiquidacionServicio extends Model {
        toJSON() {
            const values = { ...this.get() };
            return values;
        }
    }

    LiquidacionServicio.init({
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true
        },
        consecutivo: {
            type: DataTypes.STRING,
            allowNull: false,
            unique: true,
            validate: {
                notNull: { msg: 'El consecutivo es obligatorio' },
                notEmpty: { msg: 'El consecutivo no puede estar vacío' },
                is: {
                    args: /^[A-Z]{2,4}-\d{4}$/,
                    msg: 'El formato debe ser AA-0000 a AAAA-0000 (letras mayúsculas, guion, cuatro dígitos)'
                }
            }
        },
        fecha_liquidacion: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW,
            validate: {
                notNull: { msg: 'La fecha de liquidación es obligatoria' },
                isDate: { msg: 'Debe ser una fecha válida' }
            }
        },
        valor_total: {
            type: DataTypes.DECIMAL(12, 2),
            allowNull: false,
            validate: {
                notNull: { msg: 'El valor total es obligatorio' },
                isDecimal: { msg: 'El valor total debe ser un número decimal' },
                min: {
                    args: [0],
                    msg: 'El valor total no puede ser negativo'
                }
            }
        },
        estado: {
            type: DataTypes.ENUM('liquidado', 'aprobado', 'rechazada', 'facturado', 'anulado'),
            allowNull: false,
            defaultValue: 'pendiente',
            validate: {
                notNull: { msg: 'El estado es obligatorio' },
                isIn: {
                    args: [['liquidado', 'aprobado', 'rechazada', 'facturado', 'anulado']],
                    msg: 'Estado no válido'
                }
            }
        },
        user_id: {
            type: DataTypes.UUID,
            allowNull: false,
            references: {
                model: 'users',
                key: 'id'
            },
            validate: {
                notNull: { msg: 'El usuario es obligatorio' }
            }
        },
        observaciones: {
            type: DataTypes.TEXT,
            allowNull: true
        }
    }, {
        sequelize,
        modelName: 'LiquidacionServicio',
        tableName: 'liquidaciones_servicios',
        underscored: true,
        timestamps: true
    });

    LiquidacionServicio.associate = function(models) {
        LiquidacionServicio.belongsTo(models.User, { as: 'user', foreignKey: 'userId' });
        LiquidacionServicio.belongsToMany(models.Servicio, { 
          through: models.ServicioLiquidacion, 
          as: 'servicios',
          foreignKey: 'liquidacion_id'
        });
      };

    return LiquidacionServicio;
};