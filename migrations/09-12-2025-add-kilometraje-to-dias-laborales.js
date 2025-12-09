/**
 * Migración: Agregar campos kilometraje_inicial y kilometraje_final
 * Fecha: 09-12-2025
 * Descripción: Añade columnas para registrar el kilometraje inicial y final
 *              de cada día laboral en la tabla dias_laborales_planillas
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    console.log('🚀 Iniciando migración: Agregar kilometraje a días laborales...');
    
    try {
      // Agregar columna kilometraje_inicial
      await queryInterface.addColumn('dias_laborales_planillas', 'kilometraje_inicial', {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: true,
        defaultValue: null,
        comment: 'Kilometraje inicial del vehículo al inicio del día laboral'
      });
      console.log('✅ Columna kilometraje_inicial agregada exitosamente');

      // Agregar columna kilometraje_final
      await queryInterface.addColumn('dias_laborales_planillas', 'kilometraje_final', {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: true,
        defaultValue: null,
        comment: 'Kilometraje final del vehículo al final del día laboral'
      });
      console.log('✅ Columna kilometraje_final agregada exitosamente');

      // Agregar índice para búsquedas por kilometraje
      await queryInterface.addIndex('dias_laborales_planillas', ['kilometraje_inicial'], {
        name: 'idx_dia_laboral_km_inicial'
      });
      console.log('✅ Índice para kilometraje_inicial creado');

      await queryInterface.addIndex('dias_laborales_planillas', ['kilometraje_final'], {
        name: 'idx_dia_laboral_km_final'
      });
      console.log('✅ Índice para kilometraje_final creado');

      console.log('✨ Migración completada exitosamente');
    } catch (error) {
      console.error('❌ Error durante la migración:', error);
      throw error;
    }
  },

  async down(queryInterface, Sequelize) {
    console.log('🔄 Revirtiendo migración: Eliminar kilometraje de días laborales...');
    
    try {
      // Eliminar índices primero
      await queryInterface.removeIndex('dias_laborales_planillas', 'idx_dia_laboral_km_inicial');
      console.log('✅ Índice kilometraje_inicial eliminado');

      await queryInterface.removeIndex('dias_laborales_planillas', 'idx_dia_laboral_km_final');
      console.log('✅ Índice kilometraje_final eliminado');

      // Eliminar columnas
      await queryInterface.removeColumn('dias_laborales_planillas', 'kilometraje_inicial');
      console.log('✅ Columna kilometraje_inicial eliminada');

      await queryInterface.removeColumn('dias_laborales_planillas', 'kilometraje_final');
      console.log('✅ Columna kilometraje_final eliminada');

      console.log('✨ Reversión completada exitosamente');
    } catch (error) {
      console.error('❌ Error durante la reversión:', error);
      throw error;
    }
  }
};
