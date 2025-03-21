// migrations/XXXXXX-create-liquidaciones.js
module.exports = {
    up: async (queryInterface, Sequelize) => {
      await queryInterface.createTable('liquidaciones', {
        id: {
          type: Sequelize.INTEGER,
          autoIncrement: true,
          allowNull: false,
          primaryKey: true,
        },
        periodo_start: {
          type: Sequelize.STRING,
          allowNull: false,
        },
        periodo_end: {
          type: Sequelize.STRING,
          allowNull: false,
        },
        auxilio_transporte: {
          type: Sequelize.DECIMAL(10, 2),
          allowNull: false,
        },
        sueldo_total: {
          type: Sequelize.DECIMAL(10, 2),
          allowNull: false,
        },
        salario_devengado: {
          type: Sequelize.DECIMAL(10, 2),
          allowNull: false,
        },
        total_pernotes: {
          type: Sequelize.DECIMAL(10, 2),
          allowNull: false,
        },
        total_bonificaciones: {
          type: Sequelize.DECIMAL(10, 2),
          allowNull: false,
        },
        total_recargos: {
          type: Sequelize.DECIMAL(10, 2),
          allowNull: false,
        },
        total_anticipos: {
          type: Sequelize.DECIMAL(10, 2),
          allowNull: false,
        },
        total_vacaciones: {
          type: Sequelize.DECIMAL(10, 2),
          allowNull: false,
        },
        periodo_start_vacaciones: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        periodo_end_vacaciones: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        dias_laborados: {
          type: Sequelize.INTEGER,
          allowNull: false,
        },
        dias_laborados_villanueva: {
          type: Sequelize.INTEGER,
          allowNull: false,
        },
        dias_laborados_anual: {
          type: Sequelize.INTEGER,
          allowNull: false,
        },
        ajuste_salarial: {
          type: Sequelize.DECIMAL(10, 2),
          allowNull: false,
        },
        salud: {
          type: Sequelize.DECIMAL(10, 2),
          allowNull: false,
        },
        pension: {
          type: Sequelize.DECIMAL(10, 2),
          allowNull: false,
        },
        cesantias: {
          type: Sequelize.DECIMAL(10, 2),
          allowNull: false,
        },
        interes_cesantias: {
          type: Sequelize.DECIMAL(10, 2),
          allowNull: false,
        },
        estado: {
          type: Sequelize.ENUM("Pendiente", "Liquidado"),
          defaultValue: "Pendiente",
          allowNull: false,
        },
        empleado_id: {
          type: Sequelize.UUID,
          references: {
            model: 'empleados',
            key: 'id'
          },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        creado_por_id: {
          type: Sequelize.UUID,
          references: {
            model: 'users',
            key: 'id'
          },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        created_at: {
          type: Sequelize.DATE,
          allowNull: false,
        },
        updated_at: {
          type: Sequelize.DATE,
          allowNull: false,
        }
      });
    },
  
    down: async (queryInterface, Sequelize) => {
      await queryInterface.dropTable('liquidaciones');
    }
  };