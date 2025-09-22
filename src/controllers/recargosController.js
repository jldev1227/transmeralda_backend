// src/controllers/recargosController.js - ADAPTADO PARA HORAS DECIMALES
const db = require('../models');
const multer = require('multer');
const path = require('path');
const { uploadPlanillaToS3 } = require('./documentoController');
const fs = require('fs').promises;

const {
  RecargoPlanilla,
  DiaLaboralPlanilla,
  DetalleRecargosDia,
  HistorialRecargoPlanilla,
  TipoRecargo,
  Conductor,
  Vehiculo,
  Empresa,
  sequelize
} = db;

const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadPath = path.join(__dirname, '../../uploads/planillas');

    // Crear directorio si no existe
    try {
      await fs.access(uploadPath);
    } catch {
      await fs.mkdir(uploadPath, { recursive: true });
    }

    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    // Generar nombre único: timestamp-uuid-originalname
    const uniqueName = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${file.originalname}`;
    cb(null, uniqueName);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/bmp'
  ];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Tipo de archivo no permitido. Solo PDF e imágenes.'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 15 * 1024 * 1024, // 15MB
  }
});

class RecargoController {

  convertirHoraDecimalATime(horaDecimal) {
    const numero = parseFloat(horaDecimal);
    if (isNaN(numero) || numero < 0 || numero >= 24) {
      return null;
    }

    const horas = Math.floor(numero);
    const minutosDecimal = numero - horas;
    const minutos = Math.round(minutosDecimal * 60);

    return `${horas.toString().padStart(2, '0')}:${minutos.toString().padStart(2, '0')}:00`;
  }

  async crear(req, res) {
    const transaction = await sequelize.transaction();

    const HORAS_LIMITE = {
      JORNADA_NORMAL: 10,      // ¡IMPORTANTE: 10 horas, no 8!
      INICIO_NOCTURNO: 21,
      FIN_NOCTURNO: 6,
    };

    /**
     * Verifica si un día específico es domingo
     */
    const esDomingo = (dia, mes, año) => {
      const fecha = new Date(año, mes - 1, dia);
      return fecha.getDay() === 0; // 0 = domingo
    };

    /**
     * Verifica si un día está en la lista de días festivos
     */
    const esDiaFestivo = (dia, diasFestivos = []) => {
      return diasFestivos.includes(dia);
    };

    /**
     * Verifica si un día es domingo O festivo
     */
    const esDomingoOFestivo = (dia, mes, año, diasFestivos = []) => {
      return esDomingo(dia, mes, año) || esDiaFestivo(dia, diasFestivos);
    };

    /**
     * Redondea un número a la cantidad de decimales especificada
     */
    const redondear = (numero, decimales = 2) => {
      const factor = Math.pow(10, decimales);
      return Math.round(numero * factor) / factor;
    };

    /**
     * Calcula las Horas Extra Diurnas
     * Fórmula del frontend: =IF(COUNTIF($R$6:$S$12,C9) > 0, 0, IF(F9>10,F9-10,0))
     */
    const calcularHoraExtraDiurna = (dia, mes, año, totalHoras, diasFestivos = []) => {
      // Si es domingo o festivo, no hay horas extra diurnas normales
      if (esDomingoOFestivo(dia, mes, año, diasFestivos)) {
        return 0;
      }

      // Si trabajó más de 10 horas, calcular extra diurna
      if (totalHoras > HORAS_LIMITE.JORNADA_NORMAL) {
        return redondear(totalHoras - HORAS_LIMITE.JORNADA_NORMAL);
      }

      return 0;
    };

    /**
     * Calcula las Horas Extra Nocturnas
     * Fórmula del frontend: =IF(COUNTIF($R$6:$S$12,C9) > 0, 0, IF(AND(F9>10,E9>21),E9-21,0))
     */
    const calcularHoraExtraNocturna = (dia, mes, año, horaFinal, totalHoras, diasFestivos = []) => {
      // Si es domingo o festivo, no hay horas extra nocturnas normales
      if (esDomingoOFestivo(dia, mes, año, diasFestivos)) {
        return 0;
      }

      // Si trabajó más de 10 horas Y terminó después de las 21:00
      if (totalHoras > HORAS_LIMITE.JORNADA_NORMAL && horaFinal > HORAS_LIMITE.INICIO_NOCTURNO) {
        return redondear(horaFinal - HORAS_LIMITE.INICIO_NOCTURNO);
      }

      return 0;
    };

    /**
     * Calcula las Horas Extra Festivas Diurnas
     * Fórmula del frontend: =IF(COUNTIF($R$6:$S$12,C9) > 0, IF(F9>10,F9-10,0),0)
     */
    const calcularHoraExtraFestivaDiurna = (dia, mes, año, totalHoras, diasFestivos = []) => {
      // Solo si es domingo o festivo
      if (esDomingoOFestivo(dia, mes, año, diasFestivos)) {
        if (totalHoras > HORAS_LIMITE.JORNADA_NORMAL) {
          return redondear(totalHoras - HORAS_LIMITE.JORNADA_NORMAL);
        }
      }

      return 0;
    };

    /**
     * Calcula las Horas Extra Festivas Nocturnas
     * Fórmula del frontend: =IF(COUNTIF($R$6:$S$12,C9) > 0, IF(AND(F9>10,E9>21),E9-21,0), 0)
     */
    const calcularHoraExtraFestivaNocturna = (dia, mes, año, horaFinal, totalHoras, diasFestivos = []) => {
      // Solo si es domingo o festivo
      if (esDomingoOFestivo(dia, mes, año, diasFestivos)) {
        // Si trabajó más de 10 horas Y terminó después de las 21:00
        if (totalHoras > HORAS_LIMITE.JORNADA_NORMAL && horaFinal > HORAS_LIMITE.INICIO_NOCTURNO) {
          return redondear(horaFinal - HORAS_LIMITE.INICIO_NOCTURNO);
        }
      }

      return 0;
    };

    /**
     * Calcula el Recargo Nocturno
     * Fórmula del frontend: =IF(C9<>"",IF(AND(D9<>"",E9<>""),(IF(D9<6,6-D9)+IF(E9>21,IF((D9>21),E9-D9,E9-21))),0),0)
     */
    const calcularRecargoNocturno = (dia, horaInicial, horaFinal) => {
      // Si no hay día registrado, retornar 0
      if (!dia) {
        return 0;
      }

      // Si no hay horas registradas, retornar 0
      if (!horaInicial || !horaFinal) {
        return 0;
      }

      let recargoNocturno = 0;

      // Recargo por iniciar antes de las 6:00 AM
      if (horaInicial < HORAS_LIMITE.FIN_NOCTURNO) {
        recargoNocturno += HORAS_LIMITE.FIN_NOCTURNO - horaInicial;
      }

      // Recargo por terminar después de las 21:00 (9:00 PM)
      if (horaFinal > HORAS_LIMITE.INICIO_NOCTURNO) {
        if (horaInicial > HORAS_LIMITE.INICIO_NOCTURNO) {
          // Si también inició después de las 21:00, es toda la jornada
          recargoNocturno += horaFinal - horaInicial;
        } else {
          // Solo las horas después de las 21:00
          recargoNocturno += horaFinal - HORAS_LIMITE.INICIO_NOCTURNO;
        }
      }

      return redondear(recargoNocturno);
    };

    /**
     * Calcula el Recargo Dominical
     * Fórmula del frontend: =IF(COUNTIF($R$6:$S$12,C9) > 0, IF(F9<=10,F9,10), 0)
     */
    const calcularRecargoDominical = (dia, mes, año, totalHoras, diasFestivos = []) => {
      // Solo si es domingo o festivo
      if (esDomingoOFestivo(dia, mes, año, diasFestivos)) {
        // Si trabajó 10 horas o menos, todas son recargo dominical
        // Si trabajó más de 10, solo las primeras 10 son recargo dominical
        return redondear(
          totalHoras <= HORAS_LIMITE.JORNADA_NORMAL
            ? totalHoras
            : HORAS_LIMITE.JORNADA_NORMAL
        );
      }

      return 0;
    };

    /**
     * Función principal que calcula todos los tipos de horas y recargos
     * BASADA EXACTAMENTE EN EL FRONTEND
     */
    const calcularTodasLasHoras = (parametros) => {
      const { dia, mes, año, horaInicial, horaFinal, diasFestivos = [] } = parametros;

      // Calcular total de horas trabajadas
      let totalHoras = horaFinal - horaInicial;
      if (totalHoras < 0) totalHoras += 24; // Cruzó medianoche
      totalHoras = redondear(totalHoras);

      // Calcular todos los tipos usando las fórmulas exactas del frontend
      const horaExtraNocturna = calcularHoraExtraNocturna(dia, mes, año, horaFinal, totalHoras, diasFestivos);
      const horaExtraDiurna = calcularHoraExtraDiurna(dia, mes, año, totalHoras, diasFestivos) - horaExtraNocturna;
      const horaExtraFestivaNocturna = calcularHoraExtraFestivaNocturna(dia, mes, año, horaFinal, totalHoras, diasFestivos)

      const resultados = {
        totalHoras,
        horaExtraDiurna: horaExtraDiurna, // No puede ser negativo
        horaExtraNocturna,
        horaExtraFestivaNocturna,
        horaExtraFestivaDiurna: calcularHoraExtraFestivaDiurna(dia, mes, año, totalHoras, diasFestivos) - horaExtraFestivaNocturna,
        recargoNocturno: calcularRecargoNocturno(dia, horaInicial, horaFinal),
        recargoDominical: calcularRecargoDominical(dia, mes, año, totalHoras, diasFestivos),
        esDomingo: dia.esDomingo,
        esFestivo: dia.esFestivo,
        esDomingoOFestivo: esDomingoOFestivo(dia, mes, año, diasFestivos),
      };

      return resultados;
    };

    // ===== FUNCIÓN CORREGIDA PARA CREAR RECARGOS =====
    const calcularYCrearRecargos = async (diaLaboral, transaction) => {
      const { hora_inicio, hora_fin, es_domingo, es_festivo, dia, mes, año } = diaLaboral;

      // Usar la función exacta del frontend
      const resultadosCalculo = calcularTodasLasHoras({
        dia: parseInt(dia),
        mes: mes || new Date().getMonth() + 1, // Default si no tienes el mes
        año: año || new Date().getFullYear(),   // Default si no tienes el año
        horaInicial: hora_inicio,
        horaFinal: hora_fin,
        diasFestivos: es_festivo ? [parseInt(dia)] : []
      });

      // Obtener tipos de recargos de la base de datos
      const tiposRecargos = await TipoRecargo.findAll({
        where: { activo: true },
        transaction
      });

      const tiposMap = {};
      tiposRecargos.forEach(tipo => {
        tiposMap[tipo.codigo] = tipo;
      });

      const recargos = {};
      const detallesCreados = [];

      // Mapear resultados a códigos de base de datos
      const mappingRecargos = [
        { campo: 'horaExtraDiurna', codigo: 'HED', nombre: 'Horas Extra Diurnas' },
        { campo: 'horaExtraNocturna', codigo: 'HEN', nombre: 'Horas Extra Nocturnas' },
        { campo: 'horaExtraFestivaDiurna', codigo: 'HEFD', nombre: 'Horas Extra Festivas Diurnas' },
        { campo: 'horaExtraFestivaNocturna', codigo: 'HEFN', nombre: 'Horas Extra Festivas Nocturnas' },
        { campo: 'recargoNocturno', codigo: 'RN', nombre: 'Recargo Nocturno' },
        { campo: 'recargoDominical', codigo: 'RD', nombre: 'Recargo Dominical/Festivo' }
      ];

      // Crear recargos basados en los resultados
      for (const mapping of mappingRecargos) {
        const horas = resultadosCalculo[mapping.campo];

        if (horas !== 0 && tiposMap[mapping.codigo]) {
          recargos[mapping.codigo] = horas;

          const detalle = await DetalleRecargosDia.create({
            dia_laboral_id: diaLaboral.id,
            tipo_recargo_id: tiposMap[mapping.codigo].id,
            horas: parseFloat(horas.toFixed(4)),
            calculado_automaticamente: true
          }, { transaction });

          detallesCreados.push(detalle);
        }
      }

      // Actualizar total_horas del día
      await diaLaboral.update({
        total_horas: parseFloat(resultadosCalculo.totalHoras.toFixed(4))
      }, { transaction });

      return {
        total_horas: resultadosCalculo.totalHoras,
        recargos,
        detalles_creados: detallesCreados,
        debug_info: resultadosCalculo
      };
    };

    // ===== FUNCIÓN COMPLETA PARA CALCULAR TOTALES =====
    const calcularTotalesRecargoDesdeDetalles = async (recargoId, transaction) => {
      const query = `
      SELECT 
        SUM(dlp.total_horas) as total_horas,
        COUNT(DISTINCT dlp.id) as total_dias,
        tr.codigo,
        SUM(drd.horas) as total_horas_tipo
      FROM dias_laborales_planillas dlp
      LEFT JOIN detalles_recargos_dias drd ON dlp.id = drd.dia_laboral_id
      LEFT JOIN tipos_recargos tr ON drd.tipo_recargo_id = tr.id
      WHERE dlp.recargo_planilla_id = :recargoId
        AND dlp.deleted_at IS NULL
      GROUP BY tr.codigo

      UNION ALL

      SELECT 
        SUM(dlp.total_horas) as total_horas,
        COUNT(DISTINCT dlp.id) as total_dias,
        'TOTAL' as codigo,
        NULL as total_horas_tipo
      FROM dias_laborales_planillas dlp
      WHERE dlp.recargo_planilla_id = :recargoId
        AND dlp.deleted_at IS NULL
    `;

      const resultados = await sequelize.query(query, {
        replacements: { recargoId },
        type: sequelize.QueryTypes.SELECT,
        transaction
      });

      const totales = {
        total_horas: 0,
        total_dias: 0,
        // Inicializar todos los tipos de recargo
        total_hed: 0,
        total_hen: 0,
        total_hefd: 0,
        total_hefn: 0,
        total_rn: 0,
        total_rd: 0,
      };

      resultados.forEach(row => {
        if (row.codigo === 'TOTAL') {
          totales.total_horas = parseFloat(row.total_horas) || 0;
          totales.total_dias = parseInt(row.total_dias) || 0;
        } else if (row.codigo && row.total_horas_tipo) {
          // Mapear códigos a campos de totales
          switch (row.codigo) {
            case 'HED':
              totales.total_hed = parseFloat(row.total_horas_tipo) || 0;
              break;
            case 'HEN':
              totales.total_hen = parseFloat(row.total_horas_tipo) || 0;
              break;
            case 'HEFD':
              totales.total_hefd = parseFloat(row.total_horas_tipo) || 0;
              break;
            case 'HEFN':
              totales.total_hefn = parseFloat(row.total_horas_tipo) || 0;
              break;
            case 'RN':
              totales.total_rn = parseFloat(row.total_horas_tipo) || 0;
              break;
            case 'RD':
              totales.total_rd = parseFloat(row.total_horas_tipo) || 0;
              break;
          }
        }
      });
      return totales;
    };

    try {
      const userId = req.user?.id;
      if (!userId) {
        await transaction.rollback();
        return res.status(401).json({
          success: false,
          message: 'Usuario no autenticado'
        });
      }

      // Obtener datos
      let data = req.body;
      if (req.body.recargo_data) {
        data = JSON.parse(req.body.recargo_data);
      }

      // Validaciones básicas
      if (!data.conductor_id || !data.vehiculo_id || !data.empresa_id || !data.dias_laborales) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: 'Faltan campos requeridos'
        });
      }

      if (!Array.isArray(data.dias_laborales) || data.dias_laborales.length === 0) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: 'Debe incluir al menos un día laboral'
        });
      }

      // ✅ CREAR RECARGO PRINCIPAL
      const recargo = await RecargoPlanilla.create({
        conductor_id: data.conductor_id,
        vehiculo_id: data.vehiculo_id,
        empresa_id: data.empresa_id,
        numero_planilla: data.numero_planilla || null,
        mes: parseInt(data.mes),
        año: parseInt(data.año),
        observaciones: data.observaciones || null,
        estado: 'pendiente',
        creado_por_id: userId,
        actualizado_por_id: userId
      }, { transaction });

      const diasCreados = [];

      // ✅ PROCESAR CADA DÍA LABORAL CON CÁLCULOS DEL FRONTEND
      for (const [index, diaOriginal] of data.dias_laborales.entries()) {
        const horaInicio = parseFloat(diaOriginal.horaInicio);
        const horaFin = parseFloat(diaOriginal.horaFin);

        // Validaciones...
        if (isNaN(horaInicio) || isNaN(horaFin)) {
          await transaction.rollback();
          return res.status(400).json({
            success: false,
            message: `Error: Horas inválidas en día ${diaOriginal.dia}`
          });
        }

        // Determinar si es domingo o festivo
        const fecha = new Date(parseInt(data.año), parseInt(data.mes) - 1, parseInt(diaOriginal.dia));
        const esDomingoCalculado = fecha.getDay() === 0;
        const esFestivoCalculado = Boolean(diaOriginal.esFestivo);

        // ✅ CREAR DÍA LABORAL
        const diaCreado = await DiaLaboralPlanilla.create({
          recargo_planilla_id: recargo.id,
          dia: parseInt(diaOriginal.dia),
          hora_inicio: horaInicio,
          hora_fin: horaFin,
          total_horas: 0, // Se calculará automáticamente
          es_domingo: esDomingoCalculado,
          es_festivo: esFestivoCalculado,
          observaciones: diaOriginal.observaciones || null,
          creado_por_id: userId,
          actualizado_por_id: userId
        }, { transaction });

        // Agregar mes y año al día creado para los cálculos
        diaCreado.mes = parseInt(data.mes);
        diaCreado.año = parseInt(data.año);

        // ✅ CALCULAR Y CREAR RECARGOS USANDO LÓGICA DEL FRONTEND
        const resultadoCalculo = await calcularYCrearRecargos(diaCreado, transaction);

        diasCreados.push({
          ...diaCreado.toJSON(),
          ...resultadoCalculo
        });

      }

      // ✅ CALCULAR Y ACTUALIZAR TOTALES
      const totalesRecargo = await calcularTotalesRecargoDesdeDetalles(recargo.id, transaction);

      await recargo.update({
        total_dias_laborados: diasCreados.length,
        total_horas_trabajadas: totalesRecargo.total_horas || diasCreados.reduce((sum, d) => sum + d.total_horas, 0),
        actualizado_por_id: userId
      }, { transaction });

      await transaction.commit();

      return res.status(201).json({
        success: true,
        message: 'Recargo registrado exitosamente',
        data: {
          recargo_id: recargo.id,
          numero_planilla: recargo.numero_planilla,
          total_dias: diasCreados.length,
          totales: totalesRecargo,
          dias_creados: diasCreados.map(d => ({
            id: d.id,
            dia: d.dia,
            total_horas: d.total_horas,
            recargos: d.recargos
          }))
        }
      });

    } catch (error) {
      await transaction.rollback();
      console.error('❌ Error creando recargo:', error);

      return res.status(500).json({
        success: false,
        message: 'Error interno del servidor',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  // Actualizar recargo existente
  async actualizar(req, res) {
    const transaction = await sequelize.transaction();

    const HORAS_LIMITE = {
      JORNADA_NORMAL: 10,      // ¡IMPORTANTE: 10 horas, no 8!
      INICIO_NOCTURNO: 21,
      FIN_NOCTURNO: 6,
    };

    /**
     * Verifica si un día específico es domingo
     */
    const esDomingo = (dia, mes, año) => {
      const fecha = new Date(año, mes - 1, dia);
      return fecha.getDay() === 0; // 0 = domingo
    };

    /**
     * Verifica si un día está en la lista de días festivos
     */
    const esDiaFestivo = (dia, diasFestivos = []) => {
      return diasFestivos.includes(dia);
    };

    /**
     * Verifica si un día es domingo O festivo
     */
    const esDomingoOFestivo = (dia, mes, año, diasFestivos = []) => {
      return esDomingo(dia, mes, año) || esDiaFestivo(dia, diasFestivos);
    };

    /**
     * Redondea un número a la cantidad de decimales especificada
     */
    const redondear = (numero, decimales = 2) => {
      const factor = Math.pow(10, decimales);
      return Math.round(numero * factor) / factor;
    };

    /**
     * Calcula las Horas Extra Diurnas
     * Fórmula del frontend: =IF(COUNTIF($R$6:$S$12,C9) > 0, 0, IF(F9>10,F9-10,0))
     */
    const calcularHoraExtraDiurna = (dia, mes, año, totalHoras, diasFestivos = []) => {
      // Si es domingo o festivo, no hay horas extra diurnas normales
      if (esDomingoOFestivo(dia, mes, año, diasFestivos)) {
        return 0;
      }

      // Si trabajó más de 10 horas, calcular extra diurna
      if (totalHoras > HORAS_LIMITE.JORNADA_NORMAL) {
        return redondear(totalHoras - HORAS_LIMITE.JORNADA_NORMAL);
      }

      return 0;
    };

    /**
     * Calcula las Horas Extra Nocturnas
     * Fórmula del frontend: =IF(COUNTIF($R$6:$S$12,C9) > 0, 0, IF(AND(F9>10,E9>21),E9-21,0))
     */
    const calcularHoraExtraNocturna = (dia, mes, año, horaFinal, totalHoras, diasFestivos = []) => {
      // Si es domingo o festivo, no hay horas extra nocturnas normales
      if (esDomingoOFestivo(dia, mes, año, diasFestivos)) {
        return 0;
      }

      // Si trabajó más de 10 horas Y terminó después de las 21:00
      if (totalHoras > HORAS_LIMITE.JORNADA_NORMAL && horaFinal > HORAS_LIMITE.INICIO_NOCTURNO) {
        return redondear(horaFinal - HORAS_LIMITE.INICIO_NOCTURNO);
      }

      return 0;
    };

    /**
     * Calcula las Horas Extra Festivas Diurnas
     * Fórmula del frontend: =IF(COUNTIF($R$6:$S$12,C9) > 0, IF(F9>10,F9-10,0),0)
     */
    const calcularHoraExtraFestivaDiurna = (dia, mes, año, totalHoras, diasFestivos = []) => {
      // Solo si es domingo o festivo
      if (esDomingoOFestivo(dia, mes, año, diasFestivos)) {
        if (totalHoras > HORAS_LIMITE.JORNADA_NORMAL) {
          return redondear(totalHoras - HORAS_LIMITE.JORNADA_NORMAL);
        }
      }

      return 0;
    };

    /**
     * Calcula las Horas Extra Festivas Nocturnas
     * Fórmula del frontend: =IF(COUNTIF($R$6:$S$12,C9) > 0, IF(AND(F9>10,E9>21),E9-21,0), 0)
     */
    const calcularHoraExtraFestivaNocturna = (dia, mes, año, horaFinal, totalHoras, diasFestivos = []) => {
      // Solo si es domingo o festivo
      if (esDomingoOFestivo(dia, mes, año, diasFestivos)) {
        // Si trabajó más de 10 horas Y terminó después de las 21:00
        if (totalHoras > HORAS_LIMITE.JORNADA_NORMAL && horaFinal > HORAS_LIMITE.INICIO_NOCTURNO) {
          return redondear(horaFinal - HORAS_LIMITE.INICIO_NOCTURNO);
        }
      }

      return 0;
    };

    /**
     * Calcula el Recargo Nocturno
     * Fórmula del frontend: =IF(C9<>"",IF(AND(D9<>"",E9<>""),(IF(D9<6,6-D9)+IF(E9>21,IF((D9>21),E9-D9,E9-21))),0),0)
     */
    const calcularRecargoNocturno = (dia, horaInicial, horaFinal) => {
      // Si no hay día registrado, retornar 0
      if (!dia) {
        return 0;
      }

      // Si no hay horas registradas, retornar 0
      if (!horaInicial || !horaFinal) {
        return 0;
      }

      let recargoNocturno = 0;

      // Recargo por iniciar antes de las 6:00 AM
      if (horaInicial < HORAS_LIMITE.FIN_NOCTURNO) {
        recargoNocturno += HORAS_LIMITE.FIN_NOCTURNO - horaInicial;
      }

      // Recargo por terminar después de las 21:00 (9:00 PM)
      if (horaFinal > HORAS_LIMITE.INICIO_NOCTURNO) {
        if (horaInicial > HORAS_LIMITE.INICIO_NOCTURNO) {
          // Si también inició después de las 21:00, es toda la jornada
          recargoNocturno += horaFinal - horaInicial;
        } else {
          // Solo las horas después de las 21:00
          recargoNocturno += horaFinal - HORAS_LIMITE.INICIO_NOCTURNO;
        }
      }

      return redondear(recargoNocturno);
    };

    /**
     * Calcula el Recargo Dominical
     * Fórmula del frontend: =IF(COUNTIF($R$6:$S$12,C9) > 0, IF(F9<=10,F9,10), 0)
     */
    const calcularRecargoDominical = (dia, mes, año, totalHoras, diasFestivos = []) => {
      // Solo si es domingo o festivo
      if (esDomingoOFestivo(dia, mes, año, diasFestivos)) {
        // Si trabajó 10 horas o menos, todas son recargo dominical
        // Si trabajó más de 10, solo las primeras 10 son recargo dominical
        return redondear(
          totalHoras <= HORAS_LIMITE.JORNADA_NORMAL
            ? totalHoras
            : HORAS_LIMITE.JORNADA_NORMAL
        );
      }

      return 0;
    };

    /**
     * Función principal que calcula todos los tipos de horas y recargos
     * BASADA EXACTAMENTE EN EL FRONTEND
     */
    const calcularTodasLasHoras = (parametros) => {
      const { dia, mes, año, horaInicial, horaFinal, diasFestivos = [] } = parametros;

      // Calcular total de horas trabajadas
      let totalHoras = horaFinal - horaInicial;
      if (totalHoras < 0) totalHoras += 24; // Cruzó medianoche
      totalHoras = redondear(totalHoras);

      // Calcular todos los tipos usando las fórmulas exactas del frontend
      const horaExtraNocturna = calcularHoraExtraNocturna(dia, mes, año, horaFinal, totalHoras, diasFestivos);
      const horaExtraDiurna = calcularHoraExtraDiurna(dia, mes, año, totalHoras, diasFestivos) - horaExtraNocturna;
      const horaExtraFestivaNocturna = calcularHoraExtraFestivaNocturna(dia, mes, año, horaFinal, totalHoras, diasFestivos)

      const resultados = {
        totalHoras,
        horaExtraDiurna: horaExtraDiurna, // No puede ser negativo
        horaExtraNocturna,
        horaExtraFestivaNocturna,
        horaExtraFestivaDiurna: calcularHoraExtraFestivaDiurna(dia, mes, año, totalHoras, diasFestivos) - horaExtraFestivaNocturna,
        recargoNocturno: calcularRecargoNocturno(dia, horaInicial, horaFinal),
        recargoDominical: calcularRecargoDominical(dia, mes, año, totalHoras, diasFestivos),
        esDomingo: esDomingo(dia, mes, año),
        esFestivo: diasFestivos.includes(dia),
        esDomingoOFestivo: esDomingoOFestivo(dia, mes, año, diasFestivos),
      };

      return resultados;
    };

    // ===== FUNCIÓN CORREGIDA PARA CREAR RECARGOS =====
    const calcularYCrearRecargos = async (diaLaboral, transaction) => {
      const { hora_inicio, hora_fin, es_domingo, es_festivo, dia, mes, año } = diaLaboral;

      // Usar la función exacta del frontend
      const resultadosCalculo = calcularTodasLasHoras({
        dia: parseInt(dia),
        mes: mes || new Date().getMonth() + 1,
        año: año || new Date().getFullYear(),
        horaInicial: hora_inicio,
        horaFinal: hora_fin,
        diasFestivos: es_festivo ? [parseInt(dia)] : []
      });

      // Obtener tipos de recargos de la base de datos
      const tiposRecargos = await TipoRecargo.findAll({
        where: { activo: true },
        transaction
      });

      const tiposMap = {};
      tiposRecargos.forEach(tipo => {
        tiposMap[tipo.codigo] = tipo;
      });

      const recargos = {};
      const detallesCreados = [];

      // Mapear resultados a códigos de base de datos
      const mappingRecargos = [
        { campo: 'horaExtraDiurna', codigo: 'HED', nombre: 'Horas Extra Diurnas' },
        { campo: 'horaExtraNocturna', codigo: 'HEN', nombre: 'Horas Extra Nocturnas' },
        { campo: 'horaExtraFestivaDiurna', codigo: 'HEFD', nombre: 'Horas Extra Festivas Diurnas' },
        { campo: 'horaExtraFestivaNocturna', codigo: 'HEFN', nombre: 'Horas Extra Festivas Nocturnas' },
        { campo: 'recargoNocturno', codigo: 'RN', nombre: 'Recargo Nocturno' },
        { campo: 'recargoDominical', codigo: 'RD', nombre: 'Recargo Dominical/Festivo' }
      ];

      // Crear recargos basados en los resultados
      for (const mapping of mappingRecargos) {
        const horas = resultadosCalculo[mapping.campo];

        if (horas !== 0 && tiposMap[mapping.codigo]) {
          recargos[mapping.codigo] = horas;

          const detalle = await DetalleRecargosDia.create({
            dia_laboral_id: diaLaboral.id,
            tipo_recargo_id: tiposMap[mapping.codigo].id,
            horas: parseFloat(horas.toFixed(4)),
            calculado_automaticamente: true
          }, { transaction });

          detallesCreados.push(detalle);
        }
      }

      // Actualizar total_horas del día
      await diaLaboral.update({
        total_horas: parseFloat(resultadosCalculo.totalHoras.toFixed(4))
      }, { transaction });

      return {
        total_horas: resultadosCalculo.totalHoras,
        recargos,
        detalles_creados: detallesCreados,
        debug_info: resultadosCalculo
      };
    };

    // ===== FUNCIÓN COMPLETA PARA CALCULAR TOTALES =====
    const calcularTotalesRecargoDesdeDetalles = async (recargoId, transaction) => {
      const query = `
      SELECT 
        SUM(dlp.total_horas) as total_horas,
        COUNT(DISTINCT dlp.id) as total_dias,
        tr.codigo,
        SUM(drd.horas) as total_horas_tipo
      FROM dias_laborales_planillas dlp
      LEFT JOIN detalles_recargos_dias drd ON dlp.id = drd.dia_laboral_id
      LEFT JOIN tipos_recargos tr ON drd.tipo_recargo_id = tr.id
      WHERE dlp.recargo_planilla_id = :recargoId
        AND dlp.deleted_at IS NULL
      GROUP BY tr.codigo

      UNION ALL

      SELECT 
        SUM(dlp.total_horas) as total_horas,
        COUNT(DISTINCT dlp.id) as total_dias,
        'TOTAL' as codigo,
        NULL as total_horas_tipo
      FROM dias_laborales_planillas dlp
      WHERE dlp.recargo_planilla_id = :recargoId
        AND dlp.deleted_at IS NULL
    `;

      const resultados = await sequelize.query(query, {
        replacements: { recargoId },
        type: sequelize.QueryTypes.SELECT,
        transaction
      });

      const totales = {
        total_horas_trabajadas: 0,
        total_dias_laborados: 0,
        // Inicializar todos los tipos de recargo
        total_hed: 0,
        total_hen: 0,
        total_hefd: 0,
        total_hefn: 0,
        total_rn: 0,
        total_rd: 0,
      };

      resultados.forEach(row => {
        if (row.codigo === 'TOTAL') {
          totales.total_horas_trabajadas = parseFloat(row.total_horas) || 0;
          totales.total_dias_laborados = parseInt(row.total_dias) || 0;
        } else if (row.codigo && row.total_horas_tipo) {
          // Mapear códigos a campos de totales
          switch (row.codigo) {
            case 'HED':
              totales.total_hed = parseFloat(row.total_horas_tipo) || 0;
              break;
            case 'HEN':
              totales.total_hen = parseFloat(row.total_horas_tipo) || 0;
              break;
            case 'HEFD':
              totales.total_hefd = parseFloat(row.total_horas_tipo) || 0;
              break;
            case 'HEFN':
              totales.total_hefn = parseFloat(row.total_horas_tipo) || 0;
              break;
            case 'RN':
              totales.total_rn = parseFloat(row.total_horas_tipo) || 0;
              break;
            case 'RD':
              totales.total_rd = parseFloat(row.total_horas_tipo) || 0;
              break;
          }
        }
      });
      return totales;
    };

    try {
      const { id } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        await transaction.rollback();
        return res.status(401).json({
          success: false,
          message: 'Usuario no autenticado'
        });
      }

      // Buscar recargo existente
      const recargoExistente = await RecargoPlanilla.findByPk(id, {
        include: [{ model: DiaLaboralPlanilla, as: 'dias_laborales' }],
        transaction
      });

      if (!recargoExistente) {
        await transaction.rollback();
        return res.status(404).json({
          success: false,
          message: 'Recargo no encontrado'
        });
      }

      // Verificar si es editable
      if (!recargoExistente.esEditable()) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: 'El recargo no puede ser editado en su estado actual'
        });
      }

      // Procesar datos de manera consistente con crear
      let data;
      let archivoInfo = null;

      if (req.body.recargo_data) {
        data = JSON.parse(req.body.recargo_data);
      } else {
        data = req.body;
      }

      // Validaciones básicas (igual que crear)
      if (!data.conductor_id || !data.vehiculo_id || !data.empresa_id || !data.dias_laborales) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: 'Faltan campos requeridos'
        });
      }

      if (!Array.isArray(data.dias_laborales) || data.dias_laborales.length === 0) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: 'Debe incluir al menos un día laboral'
        });
      }

      if (req.file) {
        try {
          // Determinar si hay un archivo anterior para eliminar
          const oldS3Key = recargoExistente.s3_key ||
            (recargoExistente.archivo_planilla_url &&
              recargoExistente.archivo_planilla_url.startsWith('planillas/') ?
              recargoExistente.archivo_planilla_url : null);

          // Subir nuevo archivo a S3 - pasar null si oldS3Key es null
          archivoInfo = await uploadPlanillaToS3(req.file, id, oldS3Key || undefined);

          logger.info(`Planilla actualizada para recargo ${id}: ${archivoInfo.s3_key}`);

        } catch (uploadError) {
          // Verificar estado de transacción ANTES de hacer rollback
          if (transaction && !transaction.finished) {
            try {
              await transaction.rollback();
            } catch (rollbackError) {
              console.error('Error en rollback:', rollbackError.message);
            }
          }

          logger.error(`Error al subir planilla: ${uploadError.message}`);

          // Limpiar archivo temporal si existe
          if (req.file && req.file.path) {
            try {
              await fs.unlink(req.file.path);
            } catch (unlinkError) {
              console.error('Error eliminando archivo temporal:', unlinkError.message);
            }
          }

          return res.status(500).json({
            success: false,
            message: 'Error al procesar el archivo de planilla',
            error: process.env.NODE_ENV === 'development' ? uploadError.message : undefined
          });
        }
      }

      // Guardar datos anteriores para historial
      const datosAnteriores = {
        recargo: recargoExistente.toJSON(),
        dias_laborales: recargoExistente.dias_laborales
      };

      // Primero eliminar los detalles de recargos
      const diasExistentes = await DiaLaboralPlanilla.findAll({
        where: { recargo_planilla_id: id },
        transaction
      });

      for (const dia of diasExistentes) {
        await DetalleRecargosDia.destroy({
          where: { dia_laboral_id: dia.id },
          force: true, // Eliminación física
          transaction
        });
      }

      // Luego eliminar los días laborales
      await DiaLaboralPlanilla.destroy({
        where: { recargo_planilla_id: id },
        force: true, // Eliminación física
        transaction
      });

      // ACTUALIZAR DATOS DEL RECARGO PRINCIPAL
      const datosActualizacion = {
        conductor_id: data.conductor_id,
        vehiculo_id: data.vehiculo_id,
        empresa_id: data.empresa_id,
        numero_planilla: data.numero_planilla || null,
        mes: parseInt(data.mes),
        año: parseInt(data.año),
        observaciones: data.observaciones || null,
        actualizado_por_id: userId,
        ...archivoInfo
      };

      await recargoExistente.update(datosActualizacion, { transaction });

      // CREAR NUEVOS DÍAS LABORALES CON LA MISMA LÓGICA QUE CREAR
      const diasCreados = [];

      for (const [index, diaOriginal] of data.dias_laborales.entries()) {
        const horaInicio = parseFloat(diaOriginal.horaInicio);
        const horaFin = parseFloat(diaOriginal.horaFin);

        // Validaciones
        if (isNaN(horaInicio) || isNaN(horaFin)) {
          await transaction.rollback();
          return res.status(400).json({
            success: false,
            message: `Error: Horas inválidas en día ${diaOriginal.dia}`
          });
        }

        // Determinar si es domingo o festivo
        const fecha = new Date(parseInt(data.año), parseInt(data.mes) - 1, parseInt(diaOriginal.dia));
        const esDomingoCalculado = fecha.getDay() === 0;
        const esFestivoCalculado = Boolean(diaOriginal.esFestivo);

        // CREAR DÍA LABORAL
        const diaCreado = await DiaLaboralPlanilla.create({
          recargo_planilla_id: id,
          dia: parseInt(diaOriginal.dia),
          hora_inicio: horaInicio,
          hora_fin: horaFin,
          total_horas: 0, // Se calculará automáticamente
          es_domingo: esDomingoCalculado,
          es_festivo: esFestivoCalculado,
          observaciones: diaOriginal.observaciones || null,
          creado_por_id: userId,
          actualizado_por_id: userId
        }, { transaction });

        // Agregar mes y año al día creado para los cálculos
        diaCreado.mes = parseInt(data.mes);
        diaCreado.año = parseInt(data.año);

        // CALCULAR Y CREAR RECARGOS USANDO LÓGICA DEL FRONTEND
        const resultadoCalculo = await calcularYCrearRecargos(diaCreado, transaction);

        diasCreados.push({
          ...diaCreado.toJSON(),
          ...resultadoCalculo
        });
      }

      // CALCULAR Y ACTUALIZAR TOTALES
      const totalesRecargo = await calcularTotalesRecargoDesdeDetalles(id, transaction);

      await recargoExistente.update({
        ...totalesRecargo,
        actualizado_por_id: userId
      }, { transaction });

      // Crear registro en historial
      await HistorialRecargoPlanilla.create({
        recargo_planilla_id: id,
        accion: 'actualizacion',
        version_anterior: recargoExistente.version - 1,
        version_nueva: recargoExistente.version,
        datos_anteriores: datosAnteriores,
        datos_nuevos: {
          recargo: recargoExistente.toJSON(),
          dias_laborales: diasCreados
        },
        realizado_por_id: userId,
        ip_usuario: req.ip,
        user_agent: req.get('User-Agent'),
        fecha_accion: new Date()
      }, { transaction });

      await transaction.commit();

      // Obtener recargo actualizado con todas las relaciones
      const recargoActualizado = await RecargoPlanilla.findByPk(id, {
        include: [
          { model: DiaLaboralPlanilla, as: 'dias_laborales' },
          { model: Conductor, as: 'conductor', attributes: ['id', 'nombre', 'apellido', 'numero_identificacion'] },
          { model: Vehiculo, as: 'vehiculo', attributes: ['id', 'placa', 'marca', 'modelo'] },
          { model: Empresa, as: 'empresa', attributes: ['id', 'nombre', 'nit'] }
        ]
      });

      return res.json({
        success: true,
        message: 'Recargo actualizado exitosamente',
        data: {
          recargo: recargoActualizado,
          resumen: {
            total_horas: totalesRecargo.total_horas_trabajadas,
            total_dias: diasCreados.length,
            archivo_adjunto: !!archivoInfo,
            version: recargoActualizado.version,
            totales: totalesRecargo,
            dias_actualizados: diasCreados.map(d => ({
              id: d.id,
              dia: d.dia,
              total_horas: d.total_horas,
              recargos: d.recargos
            }))
          }
        }
      });

    } catch (error) {
      await transaction.rollback();
      console.error('❌ Error actualizando recargo:', error);

      // Eliminar archivo nuevo si se subió pero falló
      if (req.file) {
        try {
          await fs.unlink(req.file.path);
        } catch (unlinkError) {
          console.error('⚠️ Error eliminando archivo:', unlinkError);
        }
      }

      return res.status(500).json({
        success: false,
        message: 'Error interno del servidor',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  // Eliminar recargo (soft delete)
  async eliminar(req, res) {
    const transaction = await sequelize.transaction();

    try {
      const { id } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'Usuario no autenticado'
        });
      }

      const recargo = await RecargoPlanilla.findByPk(id, { transaction });

      if (!recargo) {
        await transaction.rollback();
        return res.status(404).json({
          success: false,
          message: 'Recargo no encontrado'
        });
      }

      // Verificar si se puede eliminar
      if (!recargo.esEditable()) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: 'El recargo no puede ser eliminado en su estado actual'
        });
      }

      // Crear registro en historial antes de eliminar
      await HistorialRecargoPlanilla.create({
        recargo_planilla_id: id,
        accion: 'eliminacion',
        version_anterior: recargo.version,
        datos_anteriores: { recargo: recargo.toJSON() },
        realizado_por_id: userId,
        ip_usuario: req.ip,
        user_agent: req.get('User-Agent'),
        fecha_accion: new Date()
      }, { transaction });

      // Soft delete
      await recargo.destroy({ transaction });

      await transaction.commit();

      return res.json({
        success: true,
        message: 'Recargo eliminado exitosamente'
      });

    } catch (error) {
      await transaction.rollback();
      console.error('❌ Error eliminando recargo:', error);

      return res.status(500).json({
        success: false,
        message: 'Error interno del servidor',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  // ✅ ENDPOINT ESPECIALIZADO PARA CANVAS (ULTRA RÁPIDO)
  async obtenerParaCanvas(req, res) {
    try {
      const { mes, año, empresa_id } = req.query;

      // Validaciones básicas
      if (!mes || !año) {
        return res.status(400).json({
          success: false,
          message: 'Mes y año son requeridos para el canvas'
        });
      }

      const where = {
        mes: parseInt(mes),
        año: parseInt(año),
      };

      if (empresa_id && this.isValidUUID(empresa_id)) {
        where.empresa_id = empresa_id;
      }

      // ✅ CONSULTA ULTRA OPTIMIZADA PARA CANVAS
      const recargos = await RecargoPlanilla.findAll({
        where,
        attributes: [
          'id', 'numero_planilla', 'mes', 'año',
          'total_horas_trabajadas', 'total_dias_laborados', 'estado',
          'created_at'
        ],
        include: [
          {
            model: Conductor,
            as: 'conductor',
            attributes: ['id', 'nombre', 'apellido']
          },
          {
            model: Vehiculo,
            as: 'vehiculo',
            attributes: ['id', 'placa']
          },
          {
            model: Empresa,
            as: 'empresa',
            attributes: ['id', 'nombre', 'nit']
          },
          {
            model: DiaLaboralPlanilla,
            as: 'dias_laborales',
            attributes: ['id', 'dia', 'hora_inicio', 'hora_fin', 'total_horas', 'es_domingo', 'es_festivo'],
            include: [
              {
                model: DetalleRecargosDia,
                as: 'detallesRecargos',
                attributes: ['id', 'horas'],
                include: [
                  {
                    model: TipoRecargo,
                    as: 'tipoRecargo',
                    attributes: ['id', 'codigo', 'nombre', 'porcentaje']
                  }
                ]
              }
            ],
            order: [['dia', 'ASC']]
          }
        ],
        order: [['numero_planilla', 'ASC']],
        raw: false,
        nest: true
      });

      // ✅ PROCESAR DATOS CON RECARGOS NORMALIZADOS
      const canvasData = recargos.map(recargo => {
        return {
          id: recargo.id,
          planilla: recargo.numero_planilla,
          conductor: recargo.conductor,
          vehiculo: recargo.vehiculo,
          empresa: recargo.empresa,
          total_horas: recargo.total_horas_trabajadas,
          total_dias: recargo.total_dias_laborados,
          estado: recargo.estado,

          // ✅ DÍAS CON RECARGOS DESDE DETALLES NORMALIZADOS
          dias_laborales: recargo.dias_laborales?.map(dia => {
            // Convertir detalles a formato esperado
            const recargosDelDia = { hed: 0, hen: 0, hefd: 0, hefn: 0, rn: 0, rd: 0 };

            dia.detallesRecargos?.forEach(detalle => {
              const codigo = detalle.tipoRecargo.codigo.toLowerCase();
              recargosDelDia[codigo] = parseFloat(detalle.horas) || 0;
            });

            return {
              id: dia.id,
              dia: dia.dia,
              hora_inicio: dia.hora_inicio,
              hora_fin: dia.hora_fin,
              total_horas: dia.total_horas,
              es_especial: dia.es_domingo || dia.es_festivo,
              es_domingo: dia.es_domingo,
              es_festivo: dia.es_festivo,
              ...recargosDelDia // hed, hen, hefd, hefn, rn, rd
            };
          }) || []
        };
      });

      return res.json({
        success: true,
        data: {
          mes: parseInt(mes),
          año: parseInt(año),
          total_recargos: canvasData.length,
          recargos: canvasData
        }
      });
    } catch (error) {
      console.error('❌ Error obteniendo datos para canvas:', error);
      return res.status(500).json({
        success: false,
        message: 'Error obteniendo datos para canvas'
      });
    }
  }

  // Obtener recargo por ID
  async obtenerPorId(req, res) {
    try {
      const { id } = req.params;

      // ✅ CONSULTA ULTRA OPTIMIZADA IGUAL QUE CANVAS (filtrada por ID)
      const recargo = await RecargoPlanilla.findOne({
        where: {
          id,
        },
        attributes: [
          'id', 'numero_planilla', 'mes', 'año',
          'total_horas_trabajadas', 'total_dias_laborados', 'planilla_s3key',
          'created_at'
        ],
        include: [
          {
            model: Conductor,
            as: 'conductor',
            attributes: ['id', 'nombre', 'apellido', 'numero_identificacion']
          },
          {
            model: Vehiculo,
            as: 'vehiculo',
            attributes: ['id', 'placa']
          },
          {
            model: Empresa,
            as: 'empresa',
            attributes: ['id', 'nombre', 'nit']
          },
          {
            model: DiaLaboralPlanilla,
            as: 'dias_laborales',
            attributes: ['id', 'dia', 'hora_inicio', 'hora_fin', 'total_horas', 'es_domingo', 'es_festivo'],
            include: [
              {
                model: DetalleRecargosDia,
                as: 'detallesRecargos',
                attributes: ['id', 'horas'],
                include: [
                  {
                    model: TipoRecargo,
                    as: 'tipoRecargo',
                    attributes: ['id', 'codigo', 'nombre', 'porcentaje']
                  }
                ]
              }
            ],
            order: [['dia', 'ASC']]
          }
        ],
        raw: false,
        nest: true
      });

      if (!recargo) {
        return res.status(404).json({
          success: false,
          message: 'Recargo no encontrado'
        });
      }

      // ✅ PROCESAR DATOS CON LA MISMA LÓGICA QUE CANVAS
      const recargoData = {
        id: recargo.id,
        planilla: recargo.numero_planilla,
        conductor: recargo.conductor,
        vehiculo: recargo.vehiculo,
        empresa: recargo.empresa,
        total_horas: recargo.total_horas_trabajadas,
        total_dias: recargo.total_dias_laborados,
        planilla_s3key: recargo.planilla_s3key,

        // ✅ DÍAS CON RECARGOS DESDE DETALLES NORMALIZADOS
        dias_laborales: recargo.dias_laborales?.map(dia => {
          // Convertir detalles a formato esperado
          const recargosDelDia = { hed: 0, hen: 0, hefd: 0, hefn: 0, rn: 0, rd: 0 };

          dia.detallesRecargos?.forEach(detalle => {
            const codigo = detalle.tipoRecargo.codigo.toLowerCase();
            recargosDelDia[codigo] = parseFloat(detalle.horas) || 0;
          });

          return {
            id: dia.id,
            dia: dia.dia,
            hora_inicio: dia.hora_inicio,
            hora_fin: dia.hora_fin,
            total_horas: dia.total_horas,
            es_especial: dia.es_domingo || dia.es_festivo,
            es_domingo: dia.es_domingo,
            es_festivo: dia.es_festivo,
            ...recargosDelDia // hed, hen, hefd, hefn, rn, rd
          };
        }) || []
      };

      return res.json({
        success: true,
        data: {
          mes: recargo.mes,
          año: recargo.año,
          total_recargos: 1, // Siempre será 1 porque es un solo recargo
          recargo: recargoData // Mismo formato que en canvas
        }
      });

    } catch (error) {
      console.error('❌ Error obteniendo recargo por ID:', error);
      return res.status(500).json({
        success: false,
        message: 'Error obteniendo recargo',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  // Métodos auxiliares de validación
  validarDatos(data) {
    const required = ['conductor_id', 'vehiculo_id', 'empresa_id', 'mes', 'año', 'dias_laborales'];

    for (const field of required) {
      if (!data[field]) {
        return `El campo ${field} es requerido`;
      }
    }

    // Validar UUIDs
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    if (!uuidRegex.test(data.conductor_id)) {
      return 'El ID del conductor no es válido';
    }

    if (!uuidRegex.test(data.vehiculo_id)) {
      return 'El ID del vehículo no es válido';
    }

    if (!uuidRegex.test(data.empresa_id)) {
      return 'El ID de la empresa no es válido';
    }

    // Validar mes y año
    const mes = parseInt(data.mes);
    const año = parseInt(data.año);

    if (mes < 1 || mes > 12) {
      return 'El mes debe estar entre 1 y 12';
    }

    if (año < 2000 || año > 2100) {
      return 'El año debe estar entre 2000 y 2100';
    }

    // Validar número de planilla si existe
    if (data.numero_planilla && data.numero_planilla.length > 50) {
      return 'El número de planilla no puede exceder 50 caracteres';
    }

    // Validar días laborales
    if (!Array.isArray(data.dias_laborales) || data.dias_laborales.length === 0) {
      return 'Debe incluir al menos un día laboral';
    }

    if (data.dias_laborales.length > 31) {
      return 'No puede haber más de 31 días laborales';
    }

    // Validar cada día laboral
    const diasUnicos = new Set();

    for (const dia of data.dias_laborales) {
      // ⚠️ CAMBIO: Ahora busca los nombres estándar de la base de datos
      // Acepta tanto el formato frontend (horaInicio/horaFin) como backend (hora_inicio/hora_fin)
      const horaInicio = dia.hora_inicio || dia.horaInicio;
      const horaFin = dia.hora_fin || dia.horaFin;

      if (!dia.dia || !horaInicio || !horaFin) {
        return 'Todos los días laborales deben tener día, hora de inicio y hora de fin';
      }

      const numeroDia = parseInt(dia.dia);

      // Verificar día único
      if (diasUnicos.has(numeroDia)) {
        return `El día ${numeroDia} está duplicado`;
      }
      diasUnicos.add(numeroDia);

      // Validar rango de día
      if (numeroDia < 1 || numeroDia > 31) {
        return `Día ${numeroDia}: Debe estar entre 1 y 31`;
      }

      // Validar formato de horas
      const validacionHoras = this.validarFormatoHoras(horaInicio, horaFin, numeroDia);
      if (validacionHoras) {
        return validacionHoras;
      }
    }

    return null; // Sin errores
  }

  // Método auxiliar para validar horas
  validarFormatoHoras(horaInicio, horaFin, dia) {
    try {
      // Convertir a formato estándar para validación
      const inicio = this.convertirATimeFormat(horaInicio);
      const fin = this.convertirATimeFormat(horaFin);

      // Validar formato TIME
      const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/;

      if (!timeRegex.test(inicio)) {
        return `Día ${dia}: Formato de hora de inicio inválido`;
      }

      if (!timeRegex.test(fin)) {
        return `Día ${dia}: Formato de hora de fin inválido`;
      }

      // Validar que hora fin > hora inicio
      const inicioDate = new Date(`1970-01-01T${inicio}`);
      const finDate = new Date(`1970-01-01T${fin}`);

      if (finDate <= inicioDate) {
        return `Día ${dia}: La hora de fin debe ser mayor que la hora de inicio`;
      }

      // Validar duración máxima (24 horas)
      const duracion = (finDate - inicioDate) / (1000 * 60 * 60);
      if (duracion > 24) {
        return `Día ${dia}: La jornada no puede exceder 24 horas`;
      }

      return null;
    } catch (error) {
      return `Día ${dia}: Error validando horas - ${error.message}`;
    }
  }

  async verificarEntidades(data, transaction) {
    try {
      // Verificar conductor
      const conductor = await Conductor.findByPk(data.conductor_id, { transaction });
      if (!conductor) {
        return 'Conductor no encontrado';
      }

      // Verificar vehículo
      const vehiculo = await Vehiculo.findByPk(data.vehiculo_id, { transaction });
      if (!vehiculo) {
        return 'Vehículo no encontrado';
      }

      // Verificar empresa
      const empresa = await Empresa.findByPk(data.empresa_id, { transaction });
      if (!empresa) {
        return 'Empresa no encontrada';
      }

      return null; // Sin errores
    } catch (error) {
      return `Error verificando entidades: ${error.message}`;
    }
  }

  async verificarDuplicados(data, transaction) {
    try {
      const existente = await RecargoPlanilla.findOne({
        where: {
          conductor_id: data.conductor_id,
          vehiculo_id: data.vehiculo_id,
          empresa_id: data.empresa_id,
          mes: parseInt(data.mes),
          año: parseInt(data.año)
        },
        transaction
      });

      if (existente) {
        return `Ya existe un recargo para este conductor, vehículo, empresa y período (${data.mes}/${data.año})`;
      }

      return null; // Sin errores
    } catch (error) {
      return `Error verificando duplicados: ${error.message}`;
    }
  }

  convertirATimeFormat(hora) {
    if (typeof hora === 'string' && hora.includes(':')) {
      // Ya está en formato HH:MM
      return hora.length === 5 ? `${hora}:00` : hora;
    }

    // Convertir de decimal a HH:MM:SS
    const horas = Math.floor(parseFloat(hora));
    const minutos = Math.round((parseFloat(hora) - horas) * 60);

    return `${horas.toString().padStart(2, '0')}:${minutos.toString().padStart(2, '0')}:00`;
  }

  calcularDiferenciaHoras(horaInicio, horaFin) {
    const inicio = new Date(`1970-01-01T${horaInicio}`);
    const fin = new Date(`1970-01-01T${horaFin}`);
    const diferencia = (fin - inicio) / (1000 * 60 * 60); // Convertir a horas
    return Math.max(0, diferencia);
  }

  procesarDiasLaborales(diasLaborales) {
    return diasLaborales.map(dia => {
      // Convertir horas a formato decimal (números)
      const horaInicio = this.convertirADecimal(dia.horaInicio);
      const horaFin = this.convertirADecimal(dia.horaFin);
      const totalHoras = horaFin - horaInicio >= 0 ? horaFin - horaInicio : (horaFin + 24) - horaInicio;

      // Generar fecha completa del día
      const fecha = new Date(parseInt(dia.año || new Date().getFullYear()),
        parseInt(dia.mes || new Date().getMonth()),
        parseInt(dia.dia));

      return {
        dia: parseInt(dia.dia),
        fecha: fecha.toISOString().split('T')[0], // YYYY-MM-DD
        hora_inicio: horaInicio, // Formato decimal (ej: 10.0)
        hora_fin: horaFin,       // Formato decimal (ej: 13.0)
        total_horas: parseFloat(totalHoras.toFixed(4)),
        horas_ordinarias: Math.min(totalHoras, 8), // Máximo 8 horas ordinarias
        hed: parseFloat(dia.hed || 0),
        hen: parseFloat(dia.hen || 0),
        hefd: parseFloat(dia.hefd || 0),
        hefn: parseFloat(dia.hefn || 0),
        rn: parseFloat(dia.rn || 0),
        rd: parseFloat(dia.rd || 0),
        es_festivo: Boolean(dia.es_festivo),
        es_domingo: Boolean(dia.es_domingo),
        es_dia_laborable: !Boolean(dia.es_festivo) && !Boolean(dia.es_domingo),
        observaciones: dia.observaciones || null
      };
    });
  }

  // Función auxiliar para convertir a decimal
  convertirADecimal(hora) {
    if (typeof hora === 'number') {
      return parseFloat(hora);
    }

    if (typeof hora === 'string') {
      // Si viene como "10.00" o "10"
      if (hora.includes('.')) {
        return parseFloat(hora);
      }
      // Si viene como "10:00" o "10:00:00"
      if (hora.includes(':')) {
        const partes = hora.split(':');
        const horas = parseInt(partes[0]);
        const minutos = parseInt(partes[1] || 0);
        return horas + (minutos / 60);
      }
      // Si viene como string numérico "10"
      return parseFloat(hora);
    }

    return 0;
  }

  calcularTotales(diasLaborales) {
    return diasLaborales.reduce((acc, dia) => {
      acc.total_horas_trabajadas += dia.total_horas;
      acc.total_hed += dia.hed;
      acc.total_hen += dia.hen;
      acc.total_hefd += dia.hefd;
      acc.total_hefn += dia.hefn;
      acc.total_rn += dia.rn;
      acc.total_rd += dia.rd;
      return acc;
    }, {
      total_horas_trabajadas: 0,
      total_hed: 0,
      total_hen: 0,
      total_hefd: 0,
      total_hefn: 0,
      total_rn: 0,
      total_rd: 0
    });
  }
}

module.exports = {
  RecargoController,
  uploadMiddleware: upload.single('planilla') // Middleware para subir archivos
};