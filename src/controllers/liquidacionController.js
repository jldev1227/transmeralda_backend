const {
  Liquidacion,
  Conductor,
  User,
  Vehiculo,
  Bonificacion,
  Mantenimiento,
  Pernote,
  Recargo,
  Anticipo,
  Empresa,
  ConfiguracionLiquidacion,
} = require("../models");

// Obtener todas las liquidaciones
exports.obtenerLiquidaciones = async (req, res) => {
  try {
    const liquidaciones = await Liquidacion.findAll({
      include: [
        { model: Conductor, as: "conductor" },
        { model: Vehiculo, as: "vehiculos" },
        { model: Bonificacion, as: "bonificaciones" },
        { model: Pernote, as: "pernotes" },
        { model: Recargo, as: "recargos" },
        { model: Anticipo, as: "anticipos" },
        {
          model: User,
          as: "creadoPor",
          attributes: ["id", "nombre", "correo"],
        }, // Cambiado a creadoPor
        {
          model: User,
          as: "liquidadoPor",
          attributes: ["id", "nombre", "correo"],
        }, // Cambiado a liquidadoPor
      ],
    });

    console.log(liquidaciones)

    res.status(200).json({
      success: true,
      count: liquidaciones.length,
      data: liquidaciones,
    });
  } catch (error) {
    console.error("Error al obtener liquidaciones:", error);
    res.status(500).json({
      success: false,
      message: "Error al obtener liquidaciones",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// Obtener una liquidación por ID
exports.obtenerLiquidacionPorId = async (req, res) => {
  try {
    const { id } = req.params;

    if (id === "configuracion") {
      return res.status(400).json({
        success: false,
        message:
          "Ruta no válida. Utilice /liquidaciones/configuracion en su lugar.",
      });
    }

    const liquidacion = await Liquidacion.findByPk(id, {
      include: [
        { model: Conductor, as: "conductor" },
        { model: Vehiculo, as: "vehiculos" },
        {
          model: Mantenimiento,
          as: "mantenimientos",
          include: [
            {
              model: Vehiculo,
              as: "vehiculo",
              attributes: ["id", "placa", "modelo", "marca"],
              required: false,
            },
          ],
        },
        {
          model: Bonificacion,
          as: "bonificaciones",
          include: [
            {
              model: Vehiculo,
              as: "vehiculo",
              attributes: ["id", "placa", "modelo", "marca"],
              required: false,
            },
          ],
        },
        {
          model: Pernote,
          as: "pernotes",
          include: [
            {
              model: Vehiculo,
              as: "vehiculo",
              attributes: ["id", "placa", "modelo", "marca"],
              required: false,
            },
          ],
        },
        {
          model: Recargo,
          as: "recargos",
          include: [
            {
              model: Vehiculo,
              as: "vehiculo",
              attributes: ["id", "placa", "modelo", "marca"],
              required: false,
            },
            {
              model: Empresa,
              as: "empresa",
              attributes: ["id", "Nombre", "NIT"],
              required: false,
            },
          ],
        },
        { model: Anticipo, as: "anticipos" },
        {
          model: User,
          as: "creadoPor",
          attributes: ["id", "nombre", "correo"],
        },
        {
          model: User,
          as: "liquidadoPor",
          attributes: ["id", "nombre", "correo"],
        },
      ],
      nest: true,
      raw: false,
    });

    if (!liquidacion) {
      return res.status(404).json({
        success: false,
        message: `Liquidación con ID ${id} no encontrada`,
      });
    }

    res.status(200).json({
      success: true,
      data: liquidacion,
    });
  } catch (error) {
    console.error("Error al obtener liquidación:", error);
    res.status(500).json({
      success: false,
      message: "Error al obtener liquidación",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};
// Crear liquidación con anticipos integrados
exports.crearLiquidacion = async (req, res) => {
  const transaction = await Liquidacion.sequelize.transaction();

  try {
    const {
      conductor_id,
      periodoStart,
      periodoEnd,
      auxilioTransporte,
      sueldoTotal,
      salarioDevengado,
      totalPernotes,
      totalBonificaciones,
      totalRecargos,
      totalAnticipos,
      totalVacaciones,
      diasLaborados,
      diasLaboradosVillanueva,
      diasLaboradosAnual,
      ajusteSalarial,
      vehiculos,
      bonificaciones,
      mantenimientos,
      pernotes,
      recargos,
      anticipos, // Nuevo campo para los anticipos desde frontend
      salud,
      pension,
      cesantias,
      interesCesantias,
      estado,
    } = req.body;

    // Obtener el ID del usuario desde el contexto
    const usuario_id = req.usuario.id; 

    // Verificar si el conductor existe
    const conductor = await Conductor.findByPk(conductor_id, {
      attributes: ["id", "nombre", "apellido", "numero_identificacion"],
      transaction,
    });

    if (!conductor) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: `El conductor con ID ${conductor_id} no existe.`,
      });
    }

    // Verificar si los vehículos existen
    const vehiculosDB = await Vehiculo.findAll({
      where: { id: vehiculos },
      transaction,
    });

    if (vehiculosDB.length !== vehiculos.length) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: "Algunos vehículos no se encontraron.",
      });
    }

    // Calcular el total de anticipos si se envían desde el frontend
    let calculatedTotalAnticipos = 0;
    if (anticipos && anticipos.length > 0) {
      calculatedTotalAnticipos = anticipos.reduce(
        (total, anticipo) => total + (anticipo.valor || 0), 
        0
      );
    }

    // Usar el total calculado o el enviado directamente
    const finalTotalAnticipos = calculatedTotalAnticipos || totalAnticipos || 0;

    // Crear la nueva liquidación
    const nuevaLiquidacion = await Liquidacion.create(
      {
        conductor_id,
        periodoStart,
        periodoEnd,
        auxilioTransporte,
        sueldoTotal,
        salarioDevengado,
        totalPernotes,
        totalBonificaciones,
        totalRecargos,
        totalAnticipos: finalTotalAnticipos, // Usar el total calculado
        totalVacaciones,
        diasLaborados,
        diasLaboradosVillanueva,
        diasLaboradosAnual,
        ajusteSalarial,
        salud,
        pension,
        cesantias,
        interesCesantias,
        estado,
        creado_por_id: usuario_id,
        liquidado_por_id: estado === "Liquidado" ? usuario_id : null,
      },
      { transaction }
    );

    // Asociar los vehículos a la liquidación
    await nuevaLiquidacion.setVehiculos(vehiculosDB, { transaction });

    // Insertar bonificaciones
    if (bonificaciones && bonificaciones.length > 0) {
      await Promise.all(
        bonificaciones.map((bono) =>
          Bonificacion.create(
            {
              liquidacion_id: nuevaLiquidacion.id,
              vehiculo_id: bono.vehiculoId,
              name: bono.name,
              values: bono.values,
              value: bono.value,
            },
            { transaction }
          )
        )
      );
    }

    // Insertar mantenimientos
    if (mantenimientos && mantenimientos.length > 0) {
      await Promise.all(
        mantenimientos.map((mantenimiento) =>
          Mantenimiento.create(
            {
              liquidacion_id: nuevaLiquidacion.id,
              vehiculo_id: mantenimiento.vehiculoId,
              values: mantenimiento.values,
              value: mantenimiento.value,
            },
            { transaction }
          )
        )
      );
    }

    // Insertar pernotes
    if (pernotes && pernotes.length > 0) {
      await Promise.all(
        pernotes.map((pernote) =>
          Pernote.create(
            {
              liquidacion_id: nuevaLiquidacion.id,
              vehiculo_id: pernote.vehiculoId,
              empresa_id: pernote.empresa_id,
              cantidad: pernote.cantidad,
              valor: pernote.valor,
              fechas: pernote.fechas,
            },
            { transaction }
          )
        )
      );
    }


    // Insertar recargos
    if (recargos && recargos.length > 0) {
      await Promise.all(
        recargos.map((recargo) =>
          Recargo.create(
            {
              liquidacion_id: nuevaLiquidacion.id,
              vehiculo_id: recargo.vehiculoId,
              empresa_id: recargo.empresa_id,
              valor: recargo.valor,
              pagCliente: recargo.pagCliente,
              mes: recargo.mes,
            },
            { transaction }
          )
        )
      );
    }

    console.log(anticipos)

    // Insertar anticipos
    if (anticipos && anticipos.length > 0) {
      await Promise.all(
        anticipos.map((anticipo) =>
          Anticipo.create(
            {
              liquidacion_id: nuevaLiquidacion.id,
              valor: anticipo.valor,
              fecha: anticipo.fecha,
              // Otros campos que pueda tener tu modelo Anticipo
            },
            { transaction }
          )
        )
      );
    }

    // Confirmar transacción
    await transaction.commit();

    // Consultar la liquidación con todas las relaciones
    const liquidacionConDetalles = await Liquidacion.findByPk(
      nuevaLiquidacion.id,
      {
        include: [
          { model: Conductor, as: "conductor" },
          { model: Vehiculo, as: "vehiculos" },
          { model: Bonificacion, as: "bonificaciones" },
          { model: Mantenimiento, as: "mantenimientos" },
          { model: Pernote, as: "pernotes" },
          { model: Recargo, as: "recargos" },
          { model: Anticipo, as: "anticipos" },
        ],
      }
    );

    res.status(201).json({
      success: true,
      data: liquidacionConDetalles,
    });
  } catch (error) {
    await transaction.rollback();
    console.error("Error al crear la liquidación:", error);
    res.status(500).json({
      success: false,
      message: "Error creando la liquidación",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// Editar una liquidación existente
exports.editarLiquidacion = async (req, res) => {
  const transaction = await Liquidacion.sequelize.transaction();

  try {
    const { id } = req.params;
    const {
      conductor_id,
      periodoStart,
      periodoEnd,
      auxilioTransporte,
      sueldoTotal,
      salarioDevengado,
      totalPernotes,
      totalBonificaciones,
      totalRecargos,
      totalAnticipos,
      totalVacaciones,
      diasLaborados,
      diasLaboradosVillanueva,
      diasLaboradosAnual,
      ajusteSalarial,
      vehiculos,
      bonificaciones,
      mantenimientos,
      pernotes,
      recargos,
      anticipos, // Nuevo campo para los anticipos desde frontend
      salud,
      pension,
      cesantias,
      interesCesantias,
      estado,
    } = req.body;

    // Buscar la liquidación existente
    const liquidacion = await Liquidacion.findByPk(id, { transaction });

    if (!liquidacion) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: "Liquidación no encontrada",
      });
    }

    // Calcular el total de anticipos si se envían desde el frontend
    let calculatedTotalAnticipos = 0;
    if (anticipos && anticipos.length > 0) {
      calculatedTotalAnticipos = anticipos.reduce(
        (total, anticipo) => total + (anticipo.valor || 0), 
        0
      );
    }

    // Usar el total calculado o el enviado directamente
    const finalTotalAnticipos = calculatedTotalAnticipos || totalAnticipos || 0;

    // Actualizar campos de la liquidación
    await liquidacion.update(
      {
        conductor_id: conductor_id || liquidacion.conductor_id,
        periodoStart,
        periodoEnd,
        auxilioTransporte,
        sueldoTotal,
        salarioDevengado,
        totalPernotes,
        totalBonificaciones,
        totalRecargos,
        totalAnticipos: finalTotalAnticipos, // Usar el total calculado
        totalVacaciones,
        diasLaborados,
        diasLaboradosVillanueva,
        diasLaboradosAnual,
        ajusteSalarial,
        salud,
        pension,
        cesantias,
        interesCesantias,
        estado,
      },
      { transaction }
    );

    // Actualizar vehículos
    if (vehiculos && vehiculos.length > 0) {
      const vehiculosDB = await Vehiculo.findAll({
        where: { id: vehiculos },
        transaction,
      });
      await liquidacion.setVehiculos(vehiculosDB, { transaction });
    }

    // Actualizar bonificaciones
    if (bonificaciones && bonificaciones.length > 0) {
      // Eliminar bonificaciones existentes
      await Bonificacion.destroy({
        where: { liquidacion_id: id },
        transaction,
      });

      // Crear nuevas bonificaciones
      await Promise.all(
        bonificaciones.map((bono) =>
          Bonificacion.create(
            {
              liquidacion_id: id,
              vehiculo_id: bono.vehiculoId,
              name: bono.name,
              values: bono.values,
              value: bono.value,
            },
            { transaction }
          )
        )
      );
    }

    // Actualizar mantenimientos
    if (mantenimientos && mantenimientos.length > 0) {
      await Mantenimiento.destroy({
        where: { liquidacion_id: id },
        transaction,
      });

      await Promise.all(
        mantenimientos.map((mantenimiento) =>
          Mantenimiento.create(
            {
              liquidacion_id: id,
              vehiculo_id: mantenimiento.vehiculoId,
              values: mantenimiento.values,
              value: mantenimiento.value,
            },
            { transaction }
          )
        )
      );
    }

    // Actualizar pernotes
    if (pernotes && pernotes.length > 0) {
      await Pernote.destroy({
        where: { liquidacion_id: id },
        transaction,
      });

      await Promise.all(
        pernotes.map((pernote) =>
          Pernote.create(
            {
              liquidacion_id: id,
              vehiculo_id: pernote.vehiculoId,
              empresa_id: pernote.empresa_id,
              cantidad: pernote.cantidad,
              valor: pernote.valor,
              fechas: pernote.fechas,
            },
            { transaction }
          )
        )
      );
    }

    // Actualizar recargos
    if (recargos && recargos.length > 0) {
      await Recargo.destroy({
        where: { liquidacion_id: id },
        transaction,
      });

      await Promise.all(
        recargos.map((recargo) =>
          Recargo.create(
            {
              liquidacion_id: id,
              vehiculo_id: recargo.vehiculoId,
              empresa_id: recargo.empresa_id,
              valor: recargo.valor,
              pagCliente: recargo.pagCliente,
              mes: recargo.mes,
            },
            { transaction }
          )
        )
      );
    }

    // Actualizar anticipos
    if (anticipos && anticipos.length > 0) {
      // Eliminar anticipos existentes
      await Anticipo.destroy({
        where: { liquidacion_id: id },
        transaction,
      });

      // Crear nuevos anticipos
      await Promise.all(
        anticipos.map((anticipo) =>
          Anticipo.create(
            {
              liquidacion_id: id,
              valor: anticipo.valor,
              fecha: anticipo.fecha,
              // Otros campos que pueda tener tu modelo Anticipo
            },
            { transaction }
          )
        )
      );
    }

    // Confirmar transacción
    await transaction.commit();

    // Obtener liquidación actualizada con todas las relaciones
    const liquidacionActualizada = await Liquidacion.findByPk(id, {
      include: [
        { model: Conductor, as: "conductor" },
        { model: Vehiculo, as: "vehiculos" },
        { model: Bonificacion, as: "bonificaciones" },
        { model: Mantenimiento, as: "mantenimientos" },
        { model: Pernote, as: "pernotes" },
        { model: Recargo, as: "recargos" },
        { model: Anticipo, as: "anticipos" },
      ],
    });

    res.status(200).json({
      success: true,
      data: liquidacionActualizada,
    });
  } catch (error) {
    await transaction.rollback();
    console.error("Error al actualizar la liquidación:", error);
    res.status(500).json({
      success: false,
      message: "Error actualizando la liquidación",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

exports.obtenerConfiguracion = async (req, res) => {
  try {
    const configuraciones = await ConfiguracionLiquidacion.findAll();

    res.status(200).json({
      success: true,
      count: configuraciones.length,
      data: configuraciones,
    });
  } catch (error) {
    console.error("Error al obtener configuraciones:", error);
    res.status(500).json({
      success: false,
      message: "Error al obtener configuraciones",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

exports.eliminarLiquidacion = async (req, res) => {
  const { id } = req.params;
  try {
    // Buscar la liquidación para verificar que existe
    const liquidacion = await Liquidacion.findByPk(id);

    if (!liquidacion) {
      throw new Error(`No se encontró la liquidación con ID: ${id}`);
    }

    console.log(`Eliminando liquidación ID: ${id}`);

    // Eliminar la liquidación - las relaciones se eliminarán automáticamente por CASCADE
    await liquidacion.destroy();

    console.log(`Liquidación ID: ${id} eliminada correctamente`);

    res.status(200).json({
      success: true,
      message: "Liquidación eliminada correctamente",
      id: id,
    });
  } catch (error) {
    console.error("Error al eliminar liquidacion:", error);
    res.status(500).json({
      success: false,
      message: "Error al eliminar liquidacion",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};
