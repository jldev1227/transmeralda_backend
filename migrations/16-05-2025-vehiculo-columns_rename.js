'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Lista de columnas a renombrar de camelCase a snake_case
    const columnsToRename = [
      ['tipoCarroceria', 'tipo_carroceria'],
      ['numero_motor', 'numero_motor'],
      ['numero_serie', 'numero_serie'],
      ['numero_chasis', 'numero_chasis'],
      ['propietario_nombre', 'propietario_nombre'],
      ['propietarioIdentificacion', 'propietario_identificacion'],
      ['fechaMatricula', 'fecha_matricula'],
      ['soatVencimiento', 'soat_vencimiento'],
      ['tecnomecanicaVencimiento', 'tecnomecanica_vencimiento'],
      ['tarjetaDeOperacionVencimiento', 'tarjeta_de_operacion_vencimiento'],
      ['polizaContractualVencimiento', 'poliza_contractual_vencimiento'],
      ['polizaExtraContractualVencimiento', 'poliza_extra_contractual_vencimiento'],
      ['polizaTodoRiesgoVencimiento', 'poliza_todo_riesgo_vencimiento'],
      // Añade aquí cualquier otra columna que necesites renombrar
    ];

    // Ejecutar todas las operaciones de renombrado
    for (const [oldName, newName] of columnsToRename) {
      await queryInterface.renameColumn('vehiculos', oldName, newName);
    }
  },

  down: async (queryInterface, Sequelize) => {
    // Revertir los cambios (de snake_case a camelCase)
    const columnsToRename = [
      ['tipo_carroceria', 'tipoCarroceria'],
      ['numero_motor', 'numero_motor'],
      ['numero_serie', 'numero_serie'],
      ['numero_chasis', 'numero_chasis'],
      ['propietario_nombre', 'propietario_nombre'],
      ['propietario_identificacion', 'propietarioIdentificacion'],
      ['fecha_matricula', 'fechaMatricula'],
      ['soat_vencimiento', 'soatVencimiento'],
      ['tecnomecanica_vencimiento', 'tecnomecanicaVencimiento'],
      ['tarjeta_de_operacion_vencimiento', 'tarjetaDeOperacionVencimiento'],
      ['poliza_contractual_vencimiento', 'polizaContractualVencimiento'],
      ['poliza_extra_contractual_vencimiento', 'polizaExtraContractualVencimiento'],
      ['poliza_todo_riesgo_vencimiento', 'polizaTodoRiesgoVencimiento'],
      // Añade aquí cualquier otra columna que necesites revertir
    ];

    // Ejecutar todas las operaciones de renombrado en reversa
    for (const [newName, oldName] of columnsToRename) {
      await queryInterface.renameColumn('vehiculos', newName, oldName);
    }
  }
};