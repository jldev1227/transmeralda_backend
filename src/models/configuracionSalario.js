const { Model, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    class ConfiguracionSalario extends Model {
        // Método para calcular valor hora trabajador
        calcularValorHoraTrabajador(horasMensuales = 240) {
            return this.salario_basico / horasMensuales;
        }

        // Verificar si está vigente
        estaVigente() {
            const ahora = new Date();
            return ahora >= this.vigencia_desde &&
                (this.vigencia_hasta === null || ahora <= this.vigencia_hasta);
        }

        // Método para determinar si aplican recargos dominicales/festivos
        aplicaRecargosDominicalFestivo() {
            return !this.paga_dias_festivos;
        }
    }

    ConfiguracionSalario.init({
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
            allowNull: false,
        },
        empresa_id: {
            type: DataTypes.UUID,
            allowNull: true, // null = configuración global
            references: {
                model: 'empresas',
                key: 'id'
            },
            comment: 'ID de la empresa (null para configuración global)',
        },
        salario_basico: {
            type: DataTypes.DECIMAL(12, 2),
            allowNull: false,
            validate: {
                min: {
                    args: [0],
                    msg: 'El salario básico debe ser mayor a 0'
                }
            },
            comment: 'Salario básico mensual',
        },
        valor_hora_trabajador: {
            type: DataTypes.DECIMAL(12, 4),
            allowNull: false,
            validate: {
                min: {
                    args: [0],
                    msg: 'El valor hora debe ser mayor a 0'
                }
            },
            comment: 'Valor por hora del trabajador',
        },
        horas_mensuales_base: {
            type: DataTypes.INTEGER,
            defaultValue: 240,
            allowNull: false,
            validate: {
                min: {
                    args: [1],
                    msg: 'Las horas mensuales deben ser mayor a 0'
                }
            },
            comment: 'Horas base mensuales para cálculos',
        },
        paga_dias_festivos: {
            type: DataTypes.BOOLEAN,
            defaultValue: false,
            allowNull: false,
            comment: 'Determina si paga días festivos/dominicales por cantidad de días ' +
                'en lugar de recargos por horas: ' +
                'true = pago por día completo (no aplica RD/HEFD/HEFN), ' +
                'false = pago por recargos en horas (aplica RD/HEFD/HEFN)',
        },
        // Campo para el modelo ConfiguracionSalario
        porcentaje_festivos: {
            type: DataTypes.DECIMAL(8, 2),
            defaultValue: 180.00,
            allowNull: false,
            validate: {
                min: {
                    args: [0],
                    msg: 'El porcentaje de días festivos no puede ser negativo'
                },
                max: {
                    args: [500],
                    msg: 'El porcentaje de días festivos no puede exceder 500%'
                }
            },
            comment: 'Porcentaje a pagar por días festivos/dominicales cuando paga_dias_festivos = true. ' +
                'Ejemplo: 75% significa que se paga 1.75 veces el valor del día normal. ' +
                'Se aplica sobre el valor diario base (valor_hora_trabajador * horas_dia_base)',
        },
        vigencia_desde: {
            type: DataTypes.DATE,
            allowNull: false,
            comment: 'Fecha desde la cual es válida esta configuración',
        },
        vigencia_hasta: {
            type: DataTypes.DATE,
            allowNull: true,
            comment: 'Fecha hasta la cual es válida (null = sin límite)',
        },
        activo: {
            type: DataTypes.BOOLEAN,
            defaultValue: true,
            allowNull: false,
            comment: 'Estado activo de la configuración',
        },
        observaciones: {
            type: DataTypes.TEXT,
            allowNull: true,
            comment: 'Observaciones sobre esta configuración salarial',
        },
        creado_por_id: {
            type: DataTypes.UUID,
            allowNull: true,
            references: {
                model: 'users',
                key: 'id'
            },
        },
    }, {
        sequelize,
        modelName: 'ConfiguracionSalario',
        tableName: 'configuraciones_salarios',
        underscored: true,
        timestamps: true,
        paranoid: true,
        indexes: [
            {
                fields: ['empresa_id', 'vigencia_desde'],
                name: 'idx_config_salario_empresa_vigencia'
            },
            {
                fields: ['activo', 'vigencia_desde'],
                name: 'idx_config_salario_activo_vigencia'
            },
            {
                fields: ['paga_dias_festivos'],
                name: 'idx_config_salario_paga_festivos'
            }
        ]
    });

    ConfiguracionSalario.associate = (models) => {
        if (models.Empresa) {
            ConfiguracionSalario.belongsTo(models.Empresa, {
                foreignKey: 'empresa_id',
                as: 'empresa'
            });
        }
        if (models.Usuario) {
            ConfiguracionSalario.belongsTo(models.Usuario, {
                foreignKey: 'creado_por_id',
                as: 'creadoPor'
            });
        }
    };

    return ConfiguracionSalario;
};