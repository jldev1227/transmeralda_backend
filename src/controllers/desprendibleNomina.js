// controllers/desprendibleNomina.js
const Queue = require("bull");
const { v4: uuidv4 } = require("uuid");
const {
  Liquidacion,
  Conductor,
  Bonificacion,
  Pernote,
  Recargo,
  Anticipo,
} = require("../models");
const nodemailer = require("nodemailer");
const PDFDocument = require("pdfkit");
const path = require("path");
const { procesarRecargosPorPeriodoConSalarios, obtenerRecargosPlanillaPorPeriodo, obtenerConfiguracionesSalario } = require("./liquidacionController");

/**
 * Función para notificar al usuario a través de Socket.IO
 * @param {string} userId - ID del usuario
 * @param {string} event - Nombre del evento
 * @param {Object} data - Datos a enviar
 */
function notifyUser(userId, event, data) {
  try {
    // Obtener la función notifyUser de la aplicación global
    const notifyFn = global.app?.get("notifyUser");

    if (notifyFn) {
      notifyFn(userId, event, data);
    } else {
      console.log(
        `No se pudo notificar al usuario ${userId} (evento: ${event}) - Socket.IO no está disponible`
      );
    }
  } catch (error) {
    console.error("Error al notificar al usuario:", error);
  }
}

/**
 * Función para actualizar el progreso de un trabajo
 * @param {string} jobId - ID del trabajo
 * @param {number} progress - Progreso (0-100)
 * @param {string} userId - ID del usuario
 */
function updateJobProgress(jobId, progress, userId) {
  const job = activeJobs.get(jobId);
  if (!job) return;

  job.progress = progress;

  // Notificar al usuario sobre el progreso
  try {
    const notifyFn = global.app?.get("notifyUser");
    if (notifyFn) {
      notifyFn(userId, "job:progress", {
        jobId,
        progress,
      });
    }
  } catch (error) {
    console.error("Error al notificar progreso:", error);
  }
}

// Crear colas de tareas con Bull
const pdfQueue = new Queue("pdf-generation", {
  redis: {
    host: process.env.REDIS_HOST || "localhost",
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD
  },
});

const emailQueue = new Queue("email-sending", {
  redis: {
    host: process.env.REDIS_HOST || "localhost",
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD
  },
});

/**
 * Función para generar un PDF de respaldo simple
 * @param {string} filename - Nombre del archivo
 * @returns {Promise<Buffer>} - Buffer del PDF generado
 */
async function generateFallbackPDF(filename) {
  return new Promise((resolve) => {
    const chunks = [];
    const doc = new PDFDocument();

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => {
      const buffer = Buffer.concat(chunks);
      resolve(buffer);
    });

    doc
      .fontSize(16)
      .text("Documento de respaldo", { align: "center" })
      .moveDown()
      .fontSize(12)
      .text(`Archivo original: ${filename}`)
      .text(`Generado: ${new Date().toLocaleString()}`);

    doc.end();
  });
}

// Registro de trabajos activos
const activeJobs = new Map();

/**
 * Controlador para generar PDFs y enviar correos electrónicos
 */
exports.generatePDFs = async (req, res) => {
  try {
    const { liquidacionIds, emailConfig } = req.body;

    if (
      !liquidacionIds ||
      !Array.isArray(liquidacionIds) ||
      liquidacionIds.length === 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Se requiere al menos una liquidación para procesar",
      });
    }

    // Obtener el ID de usuario
    const userId = req.user?.id;

    // Crear un ID único para el trabajo
    const jobId = uuidv4();

    // Inicializar el estado del trabajo
    activeJobs.set(jobId, {
      userId,
      status: "queued",
      progress: 0,
      startTime: new Date(),
      liquidacionIds,
      totalEmails: liquidacionIds.length,
      error: null,
    });

    // Agregar trabajo a la cola de generación de PDFs
    await pdfQueue.add(
      {
        jobId,
        userId,
        liquidacionIds,
        emailConfig,
      },
      {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 5000, // 5 segundos de retraso inicial
        },
      }
    );

    // Devolver respuesta inmediata con el ID del trabajo
    res.status(202).json({
      success: true,
      message: "Proceso de generación y envío iniciado",
      jobId,
    });
  } catch (error) {
    console.error("Error al iniciar generación de PDFs:", error);
    res.status(500).json({
      success: false,
      message: "Error al iniciar el proceso",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Controlador para verificar el estado de un trabajo
 */
exports.checkJobStatus = async (req, res) => {
  try {
    const { jobId } = req.params;

    if (!jobId || !activeJobs.has(jobId)) {
      return res.status(404).json({
        success: false,
        message: "Trabajo no encontrado",
      });
    }

    const job = activeJobs.get(jobId);

    // Verificar que el trabajo pertenece al usuario (seguridad)
    if (job.userId !== req.user?.id) {
      return res.status(403).json({
        success: false,
        message: "No tiene permiso para acceder a este trabajo",
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        jobId,
        status: job.status,
        progress: job.progress,
        startTime: job.startTime,
        totalEmails: job.totalEmails,
        ...(job.completedTime && { completedTime: job.completedTime }),
        ...(job.error && { error: job.error }),
      },
    });
  } catch (error) {
    console.error("Error al consultar estado del trabajo:", error);
    res.status(500).json({
      success: false,
      message: "Error al consultar estado del trabajo",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

const getMesyAño = (dateStr) => {
  if (!dateStr) return "";
  try {
    const date = new Date(dateStr);
    return date
      .toLocaleDateString("es-CO", {
        month: "long",
        year: "numeric",
      })
      .toUpperCase();
  } catch (e) {
    console.error("Error formatting date:", e);
    return "";
  }
};

// Manejador para la cola de generación de PDFs
pdfQueue.process(async (job, done) => {
  const { jobId, userId, liquidacionIds, emailConfig } = job.data;

  try {
    // Obtener el estado del trabajo
    const jobState = activeJobs.get(jobId);
    if (!jobState) {
      throw new Error("Trabajo no encontrado");
    }

    // Actualizar estado a procesando
    jobState.status = "processing";
    updateJobProgress(jobId, 10, userId);

    // Obtener liquidaciones con datos de conductor
    const liquidaciones = await Liquidacion.findAll({
      where: { id: liquidacionIds },
      include: [
        { model: Conductor, as: "conductor" },
        { model: Bonificacion, as: "bonificaciones" },
        { model: Pernote, as: "pernotes" },
        { model: Recargo, as: "recargos" },
        { model: Anticipo, as: "anticipos" },
      ],
    });

    if (liquidaciones.length === 0) {
      throw new Error("No se encontraron liquidaciones para procesar");
    }

    // Verificar que todos los conductores tienen email
    const sinEmail = liquidaciones.filter(
      (liq) => !liq.conductor || !liq.conductor.email
    );
    if (sinEmail.length > 0) {
      throw new Error(
        `${sinEmail.length} conductores no tienen email configurado`
      );
    }

    // Generar PDFs para cada liquidación
    const pdfBuffers = [];
    for (let i = 0; i < liquidaciones.length; i++) {
      const liquidacion = liquidaciones[i];

      // Actualizar progreso
      const progress = Math.round(10 + (i / liquidaciones.length) * 50); // 10% - 60%
      updateJobProgress(jobId, progress, userId);

      try {
        // ✅ PASO 1: Obtener configuraciones de salario usando función auxiliar
        const configuracionesSalario = await obtenerConfiguracionesSalario(
          liquidacion.periodo_start,
          liquidacion.periodo_end
        );

        // ✅ PASO 2: Obtener recargos planilla del conductor usando función auxiliar
        let recargosDelPeriodo = [];
        if (liquidacion.conductor?.id) {
          recargosDelPeriodo = await obtenerRecargosPlanillaPorPeriodo(
            liquidacion.conductor.id,
            liquidacion.periodo_start,
            liquidacion.periodo_end
          );
        } else {
          console.warn(`⚠️ Liquidación ${liquidacion.id} no tiene conductor válido`);
        }

        // ✅ PASO 3: Procesar recargos con configuración salarial usando función auxiliar
        let recargosProcessados = [];
        if (recargosDelPeriodo.length > 0) {
          recargosProcessados = await procesarRecargosPorPeriodoConSalarios(
            recargosDelPeriodo,
            liquidacion.periodo_start,
            liquidacion.periodo_end,
            configuracionesSalario
          );
        }

        // ✅ PASO 4: Construir liquidación completa para PDF
        const liquidacionCompleta = {
          ...liquidacion.toJSON(),
          configuraciones_salario: configuracionesSalario,
          recargos_planilla: {
            periodo_start: liquidacion.periodo_start,
            periodo_end: liquidacion.periodo_end,
            total_recargos: recargosProcessados.length,
            total_dias_laborados: recargosProcessados.reduce((total, recargo) =>
              total + (recargo.dias_laborales?.length || 0), 0),
            total_horas_trabajadas: recargosProcessados.reduce((total, recargo) =>
              total + (parseFloat(recargo.total_horas) || 0), 0),
            recargos: recargosProcessados
          }
        };

        // ✅ PASO 5: Generar PDF con los datos completos
        const pdfBuffer = await generatePDF(liquidacionCompleta);

        // Verificar que el buffer es válido
        if (!Buffer.isBuffer(pdfBuffer)) {
          console.error(
            `❌ Error: El PDF generado para liquidación ${liquidacion.id} no es un Buffer válido`
          );
          throw new Error("El PDF generado no es válido");
        }

        // Verificar tamaño y contenido
        if (pdfBuffer.length <= 10) {
          console.error(
            `❌ Error: El PDF generado para liquidación ${liquidacion.id} está vacío o demasiado pequeño`
          );
          throw new Error("El PDF generado está vacío o es muy pequeño");
        }
        console.log(`✅ PDF generado exitosamente para liquidación ${liquidacion.id} (${pdfBuffer.length} bytes)`);

        pdfBuffers.push({
          data: pdfBuffer,
          filename: `${liquidacion.conductor?.numero_identificacion || ""}_${liquidacion.id}_${getMesyAño(liquidacion.periodo_end)}.pdf`,
          conductorId: liquidacion.conductor?.id,
          email: liquidacion.conductor?.email,
          liquidacionId: liquidacion.id,
          // Agregar información adicional para debugging si es necesario
          recargos_procesados: recargosProcessados.length,
          configuraciones_encontradas: configuracionesSalario.length
        });

      } catch (pdfError) {
        console.error(
          `❌ Error al generar PDF para liquidación ${liquidacion.id}:`,
          pdfError
        );

        // Opcional: Agregar más información del error para debugging
        console.error(`📋 Detalles de la liquidación con error:`, {
          id: liquidacion.id,
          conductor_id: liquidacion.conductor?.id,
          periodo_start: liquidacion.periodo_start,
          periodo_end: liquidacion.periodo_end,
          error_message: pdfError.message
        });
      }
    }

    // Verificar que se generaron PDFs
    if (pdfBuffers.length === 0) {
      throw new Error("No se pudo generar ningún PDF");
    }

    // Actualizar progreso
    updateJobProgress(jobId, 60, userId); // 60%

    // Agregar trabajo a la cola de envío de correos
    await emailQueue.add(
      {
        jobId,
        userId,
        pdfBuffers,
        liquidacionIds,
        emailConfig,
      },
      {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 5000,
        },
      }
    );

    // El trabajo actual está completo (la cola de emails continuará el proceso)
    return done(null, { success: true });
  } catch (error) {
    console.error(`Error en generación de PDFs para trabajo ${jobId}:`, error);

    // Actualizar estado del trabajo
    const jobState = activeJobs.get(jobId);
    if (jobState) {
      jobState.status = "failed";
      jobState.error =
        error.message || "Error desconocido durante la generación de PDFs";

      // Notificar al usuario
      notifyUser(userId, "job:failed", {
        jobId,
        error: jobState.error,
      });
    }

    return done(error);
  }
});

// Manejador para la cola de envío de correos
emailQueue.process(async (job, done) => {
  const { jobId, userId, pdfBuffers, emailConfig, liquidacionIds } = job.data;

  try {
    // Obtener el estado del trabajo
    const jobState = activeJobs.get(jobId);
    if (!jobState) {
      throw new Error("Trabajo no encontrado");
    }

    // Actualizar progreso
    updateJobProgress(jobId, 65, userId); // 65%

    // ===== OBTENER TODAS LAS LIQUIDACIONES CON CONDUCTORES Y RECARGOS =====
    const liquidacionesCompletas = await Liquidacion.findAll({
      where: {
        id: liquidacionIds
      },
      include: [
        {
          model: Conductor,
          as: 'conductor',
          attributes: ['id', 'email', 'nombre', 'apellido']
        },
        {
          model: Recargo,
          as: "recargos"
        }
      ]
    });

    if (liquidacionesCompletas.length === 0) {
      throw new Error("No se encontraron liquidaciones para procesar");
    }

    // ===== CREAR MAPEO LIQUIDACIÓN -> DATOS COMPLETOS =====
    const liquidacionToDatos = {};

    liquidacionesCompletas.forEach(liquidacion => {
      const recargosParex = liquidacion.recargos?.filter(
        (recargo) => recargo.empresa_id === "cfb258a6-448c-4469-aa71-8eeafa4530ef"
      ) || [];

      const totalRecargosParex = recargosParex.reduce(
        (sum, recargo) => sum + (recargo.valor || 0),
        0
      );

      liquidacionToDatos[liquidacion.id] = {
        email: liquidacion.conductor.email,
        conductorId: liquidacion.conductor.id,
        conductorNombre: `${liquidacion.conductor.nombre} ${liquidacion.conductor.apellido}`,
        firmaDesprendible: true, // ✅ TODOS los desprendibles requieren firma
        totalRecargos: totalRecargosParex,
        recargosCount: recargosParex.length,
        periodoEnd: liquidacion.periodo_end,
        periodoStart: liquidacion.periodo_start,
        es_cotransmeq: liquidacion.es_cotransmeq || false
      };
    });

    // ===== HELPER: Función para formatear período =====
    const getMesyAño = (dateStr) => {
      if (!dateStr) return "";
      try {
        const date = new Date(dateStr);
        return date
          .toLocaleDateString("es-CO", {
            month: "long",
            year: "numeric",
          })
          .toUpperCase();
      } catch (e) {
        console.error("Error formatting date:", e);
        return "";
      }
    };

    const emailData = {};
    const pdfsNoCorrelacionados = [];

    for (let pdfIndex = 0; pdfIndex < pdfBuffers.length; pdfIndex++) {
      const pdf = pdfBuffers[pdfIndex];

      // MÉTODO 1: Buscar por liquidación ID en el filename
      let liquidacionIdFromFilename = null;
      const liquidacionIdMatch = pdf.filename.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/);
      if (liquidacionIdMatch) {
        liquidacionIdFromFilename = liquidacionIdMatch[0];
      }

      // MÉTODO 2: Buscar por conductorId si está disponible
      let liquidacionIdFromConductor = null;
      if (pdf.conductorId) {
        const liquidacionPorConductor = Object.entries(liquidacionToDatos).find(
          ([id, datos]) => datos.conductorId === pdf.conductorId
        );
        if (liquidacionPorConductor) {
          liquidacionIdFromConductor = liquidacionPorConductor[0];
        }
      }

      // MÉTODO 3: Buscar por email si está disponible
      let liquidacionIdFromEmail = null;
      if (pdf.email) {
        const liquidacionPorEmail = Object.entries(liquidacionToDatos).find(
          ([id, datos]) => datos.email === pdf.email
        );
        if (liquidacionPorEmail) {
          liquidacionIdFromEmail = liquidacionPorEmail[0];
        }
      }

      // Decidir qué liquidación usar (prioridad: filename > conductorId > email)
      const liquidacionId = liquidacionIdFromFilename || liquidacionIdFromConductor || liquidacionIdFromEmail;

      if (!liquidacionId || !liquidacionToDatos[liquidacionId]) {
        console.error(`❌ No se pudo correlacionar PDF: ${pdf.filename}`);
        console.error(`   - ID del filename: ${liquidacionIdFromFilename}`);
        console.error(`   - ID del conductor: ${liquidacionIdFromConductor}`);
        console.error(`   - ID del email: ${liquidacionIdFromEmail}`);
        pdfsNoCorrelacionados.push(pdf);
        continue;
      }

      const datosLiquidacion = liquidacionToDatos[liquidacionId];
      const email = datosLiquidacion.email;

      // Inicializar estructura para el email si no existe
      if (!emailData[email]) {
        emailData[email] = {
          conductorNombre: datosLiquidacion.conductorNombre,
          liquidaciones: []
        };
      }

      try {
        // Procesar PDF content
        let pdfContent;

        if (Buffer.isBuffer(pdf.data)) {
          pdfContent = pdf.data;
        } else if (typeof pdf.data === "string") {
          pdfContent = Buffer.from(pdf.data, "base64");
        } else if (pdf.data && typeof pdf.data === "object") {
          if (pdf.data.type === "Buffer" && Array.isArray(pdf.data.data)) {
            pdfContent = Buffer.from(pdf.data.data);
          } else if (pdf.data.buffer && Buffer.isBuffer(pdf.data.buffer)) {
            pdfContent = pdf.data.buffer;
          } else {
            pdfContent = await generateFallbackPDF(pdf.filename);
          }
        } else {
          pdfContent = await generateFallbackPDF(pdf.filename);
        }

        // Verificar que el contenido es válido
        if (Buffer.isBuffer(pdfContent) && pdfContent.length > 0) {
          emailData[email].liquidaciones.push({
            liquidacionId: liquidacionId,
            firmaDesprendible: datosLiquidacion.firmaDesprendible,
            totalRecargos: datosLiquidacion.totalRecargos,
            periodoFormateado: getMesyAño(datosLiquidacion.periodoEnd),
            es_cotransmeq: datosLiquidacion.es_cotransmeq || false,
            attachment: {
              filename: pdf.filename,
              content: pdfContent,
              contentType: "application/pdf",
            }
          });
        } else {
          console.error(`❌ Buffer inválido para ${pdf.filename}`);
        }
      } catch (attachmentError) {
        console.error(`❌ Error procesando ${pdf.filename}:`, attachmentError);

        try {
          const fallbackPdf = await generateFallbackPDF(pdf.filename);
          emailData[email].liquidaciones.push({
            liquidacionId: liquidacionId,
            firmaDesprendible: datosLiquidacion.firmaDesprendible,
            totalRecargos: datosLiquidacion.totalRecargos,
            periodoFormateado: getMesyAño(datosLiquidacion.periodoEnd),
            es_cotransmeq: datosLiquidacion.es_cotransmeq || false,
            attachment: {
              filename: pdf.filename,
              content: fallbackPdf,
              contentType: "application/pdf",
            }
          });
        } catch (fallbackError) {
          console.error(`❌ Error generando respaldo para ${pdf.filename}:`, fallbackError);
        }
      }
    }

    // ===== VERIFICAR COBERTURA COMPLETA =====
    const emailsConPdfs = Object.keys(emailData);
    const totalPdfsAsignados = Object.values(emailData).reduce(
      (total, data) => total + data.liquidaciones.length, 0
    );

    // ===== EL RESTO DEL CÓDIGO DE ENVÍO PERMANECE IGUAL =====

    for (let i = 0; i < emailsConPdfs.length; i++) {
      const email = emailsConPdfs[i];
      const data = emailData[email];

      if (data.liquidaciones.length === 0) {
        console.warn(`⚠️ No hay liquidaciones válidas para ${email}, omitiendo`);
        continue;
      }

      const progress = Math.round(65 + (i / emailsConPdfs.length) * 35);
      updateJobProgress(jobId, progress, userId);

      const liquidacionesConFirma = data.liquidaciones.filter(liq => liq.firmaDesprendible);
      const liquidacionesSinFirma = data.liquidaciones.filter(liq => !liq.firmaDesprendible);

      let emailOptions = {
        to: email,
        subject: emailConfig.subject,
        text: emailConfig.body,
        liquidacionId: data.liquidaciones[0].liquidacionId,
        firmaDesprendible: false,
        attachments: [],
        liquidacionesParaFirma: [],
        hasAttachments: false,
        mensajeContextual: "",
        es_cotransmeq: data.liquidaciones[0].es_cotransmeq || false
      };

      if (liquidacionesConFirma.length === 0) {
        emailOptions.attachments = liquidacionesSinFirma.map(liq => liq.attachment);
        emailOptions.hasAttachments = true;
        emailOptions.mensajeContextual = `Encontrará adjuntos ${liquidacionesSinFirma.length} desprendible${liquidacionesSinFirma.length > 1 ? 's' : ''} de nómina.`;

      } else if (liquidacionesSinFirma.length === 0) {
        emailOptions.firmaDesprendible = true;
        emailOptions.liquidacionesParaFirma = liquidacionesConFirma;

        if (liquidacionesConFirma.length === 1) {
          emailOptions.mensajeContextual = `Su desprendible de ${liquidacionesConFirma[0].periodoFormateado} requiere firma digital.`;
        } else {
          emailOptions.mensajeContextual = `Tiene ${liquidacionesConFirma.length} desprendibles que requieren firma digital.`;
        }

      } else {
        emailOptions.attachments = liquidacionesSinFirma.map(liq => liq.attachment);
        emailOptions.hasAttachments = true;
        emailOptions.firmaDesprendible = true;
        emailOptions.liquidacionesParaFirma = liquidacionesConFirma;

        if (liquidacionesConFirma.length === 1) {
          emailOptions.mensajeContextual = `Encontrará adjunto${liquidacionesSinFirma.length > 1 ? 's' : ''} ${liquidacionesSinFirma.length} desprendible${liquidacionesSinFirma.length > 1 ? 's' : ''}. Adicionalmente, su desprendible de ${liquidacionesConFirma[0].periodoFormateado} requiere firma digital.`;
        } else {
          emailOptions.mensajeContextual = `Encontrará adjuntos ${liquidacionesSinFirma.length} desprendible${liquidacionesSinFirma.length > 1 ? 's' : ''}. Adicionalmente, tiene ${liquidacionesConFirma.length} desprendibles que requieren firma digital.`;
        }
      }

      try {
        await sendEmail(emailOptions);
      } catch (emailErr) {
        console.error(`❌ Error enviando email a ${email}:`, emailErr);
      }
    }

    // Actualizar estado a completado
    jobState.status = "completed";
    jobState.progress = 100;
    jobState.completedTime = new Date();

    notifyUser(userId, "job:completed", {
      jobId,
      result: {
        totalEmails: emailsConPdfs.length,
        totalAttachments: totalPdfsAsignados,
        pdfsNoCorrelacionados: pdfsNoCorrelacionados.length
      },
    });

    setTimeout(() => {
      activeJobs.delete(jobId);
    }, 30 * 60 * 1000);

    return done(null, { success: true });
  } catch (error) {
    console.error(`❌ Error en envío de emails para trabajo ${jobId}:`, error);

    const jobState = activeJobs.get(jobId);
    if (jobState) {
      jobState.status = "failed";
      jobState.error = error.message || "Error desconocido durante el envío de correos";

      notifyUser(userId, "job:failed", {
        jobId,
        error: jobState.error,
      });
    }

    return done(error);
  }
});

/**
 * Construir URL pública de S3
 * @param {string} fileName - Nombre del archivo en S3
 * @param {string} folder - Carpeta en S3 (default: 'assets')
 * @returns {string} URL pública completa
 */
function getS3PublicUrl(fileName, folder = 'assets') {
  const bucketName = process.env.AWS_S3_BUCKET_NAME || 'transmeralda';
  const region = process.env.AWS_REGION || 'us-east-2';

  return `https://${bucketName}.s3.${region}.amazonaws.com/${folder}/${fileName}`;
}

// Función para crear el template HTML
function createEmailTemplate(content, options = {}) {
  const {
    logoFileName = 'codi.png',
    companyName = 'Transportes y Servicios Esmeralda S.A.S',
    showLogo = true,
    liquidacionId,
    firmaDesprendible = false,
    liquidacionesParaFirma = [],
    hasAttachments = false,
    mensajeContextual = '',
    es_cotransmeq = false
  } = options;

  // Definir colores y datos según la empresa
  const primaryColor = es_cotransmeq ? '#FF9500' : '#059669';
  const primaryColorDark = es_cotransmeq ? '#E68A00' : '#047857';
  const lightBg = es_cotransmeq ? '#FFF4E6' : '#ecfdf5';
  const borderColor = es_cotransmeq ? '#FFA726' : '#10b981';
  const textColor = es_cotransmeq ? '#92400E' : '#065f46';
  const finalCompanyName = es_cotransmeq 
    ? 'Servicios y Transportes Cotransmeq S.A.S' 
    : companyName;
  const finalLogoFileName = es_cotransmeq ? 'cotransmeq.png' : logoFileName;

  // Construir URL del logo desde S3
  const logoUrl = showLogo ? getS3PublicUrl(finalLogoFileName) : null;

  // Obtener año actual
  const currentYear = new Date().getFullYear();

  // Generar contenido dinámico según el tipo de envío
  let desprendiblesSection = '';

  if (firmaDesprendible && liquidacionesParaFirma.length > 0) {
    if (liquidacionesParaFirma.length === 1) {
      // Un solo enlace - usar botón actual
      const liquidacion = liquidacionesParaFirma[0];
      const desprendibleUrl = `${process.env.NOMINA_SYSTEM}/conductores/desprendible/${liquidacion.liquidacionId}`;

      desprendiblesSection = `
        <div class="desprendible-section">
          <h3>📄 Desprendible de Nómina</h3>
          <p>Haga clic en el siguiente botón para ver y firmar su desprendible de <strong>${liquidacion.periodoFormateado}</strong>:</p>
          <a href="${desprendibleUrl}" class="button" target="_blank" rel="noopener">
            Ver y Firmar Desprendible
          </a>
          <p style="font-size: 14px; margin-top: 15px; color: #6b7280;">
            <strong>Importante:</strong> Este enlace le permitirá acceder a su desprendible de manera segura.
          </p>
        </div>
      `;
    } else {
      // Múltiples enlaces - crear lista
      const enlaces = liquidacionesParaFirma.map(liquidacion => {
        const desprendibleUrl = `${process.env.NOMINA_SYSTEM}/conductores/desprendible/${liquidacion.liquidacionId}`;
        return `
          <div class="enlace-individual">
            <h4>📄 ${liquidacion.periodoFormateado}</h4>
            <a href="${desprendibleUrl}" class="button-small" target="_blank" rel="noopener">
              Ver y Firmar Desprendible
            </a>
          </div>
        `;
      }).join('');

      desprendiblesSection = `
        <div class="desprendible-section">
          <h3>📄 Desprendibles que Requieren Firma</h3>
          <p>Tiene <strong>${liquidacionesParaFirma.length} desprendibles</strong> que requieren firma digital:</p>
          <div class="enlaces-container">
            ${enlaces}
          </div>
          <p style="font-size: 14px; margin-top: 20px; color: #6b7280;">
            <strong>Importante:</strong> Cada enlace le permitirá acceder al desprendible correspondiente de manera segura.
          </p>
        </div>
      `;
    }
  }

  const template = `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Comprobante de Nómina</title>
    <style>
        /* Reset */
        body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
        table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
        img { -ms-interpolation-mode: bicubic; border: 0; outline: none; text-decoration: none; }
        
        /* Estilos principales */
        body {
            margin: 0 !important;
            padding: 0 !important;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, Arial, sans-serif !important;
            background-color: #f8fafc !important;
            line-height: 1.6;
        }
        
        .email-wrapper {
            width: 100%;
            background-color: #f8fafc;
            padding: 20px 0;
        }
        
        .email-container {
            max-width: 600px;
            margin: 0 auto;
            background-color: #ffffff;
            border-radius: 12px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            overflow: hidden;
        }
        
        .header {
            background: linear-gradient(135deg, ${primaryColor}, ${primaryColorDark});
            padding: 30px 20px;
            text-align: center;
            color: white;
        }
        
        .logo {
            max-width: 250px;
            height: auto;
            margin-bottom: 15px;
            display: inline-block;
        }
        
        .header h1 {
            margin: 10px 0 5px 0;
            font-size: 24px;
            font-weight: 600;
            color: #ffffff;
        }
        
        .content {
            padding: 40px 30px;
            color: #374151;
        }
        
        .content h2 {
            color: ${primaryColor};
            margin-top: 0;
            margin-bottom: 20px;
            font-size: 20px;
            border-bottom: 2px solid ${lightBg};
            padding-bottom: 10px;
        }
        
        .content p {
            margin-bottom: 16px;
            font-size: 16px;
            line-height: 1.6;
        }
        
        .mensaje-contextual {
            background-color: #f0f9ff;
            border-left: 4px solid #0284c7;
            padding: 20px;
            margin: 25px 0;
            border-radius: 6px;
        }
        
        .mensaje-contextual p {
            margin: 0;
            color: #0369a1;
            font-size: 16px;
        }
        
        .button {
            display: inline-block;
            background: linear-gradient(135deg, ${primaryColor}, ${primaryColorDark});
            color: white !important;
            padding: 14px 28px;
            text-decoration: none;
            border-radius: 8px;
            font-weight: 600;
            margin: 20px 0;
            text-align: center;
            transition: all 0.3s ease;
            box-shadow: 0 4px 6px rgba(${es_cotransmeq ? '255, 149, 0' : '5, 150, 105'}, 0.3);
        }
        
        .button:hover {
            background: linear-gradient(135deg, ${primaryColorDark}, ${primaryColor});
            transform: translateY(-2px);
            box-shadow: 0 6px 12px rgba(${es_cotransmeq ? '255, 149, 0' : '5, 150, 105'}, 0.4);
        }
        
        .button-small {
            display: inline-block;
            background: linear-gradient(135deg, #0284c7, #0369a1);
            color: white !important;
            padding: 10px 20px;
            text-decoration: none;
            border-radius: 6px;
            font-weight: 500;
            font-size: 14px;
            margin: 10px 0;
            text-align: center;
            transition: all 0.3s ease;
        }
        
        .desprendible-section {
            background-color: #f0f9ff;
            border: 2px solid #0284c7;
            padding: 25px;
            border-radius: 10px;
            margin: 25px 0;
            text-align: center;
        }
        
        .desprendible-section h3 {
            color: #0284c7;
            margin: 0 0 15px 0;
            font-size: 18px;
        }
        
        .desprendible-section p {
            color: #0369a1;
            margin-bottom: 20px;
        }
        
        .enlaces-container {
            display: flex;
            flex-direction: column;
            gap: 15px;
            margin: 20px 0;
        }
        
        .enlace-individual {
            background-color: #ffffff;
            border: 1px solid #e0e7ff;
            padding: 15px;
            border-radius: 8px;
            text-align: center;
        }
        
        .enlace-individual h4 {
            margin: 0 0 10px 0;
            color: #1e40af;
            font-size: 16px;
        }
        
        .attachment-notice {
            background-color: #fef3c7;
            border: 1px solid #fcd34d;
            padding: 15px;
            border-radius: 6px;
            margin: 20px 0;
        }
        
        .attachment-notice p {
            margin: 0;
            color: #92400e;
        }
        
        .footer {
            background-color: #f9fafb;
            padding: 30px;
            text-align: center;
            border-top: 2px solid #e5e7eb;
            color: #6b7280;
            font-size: 13px;
        }
        
        .footer p {
            margin: 5px 0;
        }
        
        /* Responsive */
        @media screen and (max-width: 600px) {
            .email-container {
                width: 100% !important;
                margin: 0 !important;
                border-radius: 0 !important;
            }
            
            .content {
                padding: 30px 20px !important;
            }
            
            .header {
                padding: 25px 15px !important;
            }
            
            .header h1 {
                font-size: 20px !important;
            }
            
            .desprendible-section {
                padding: 20px 15px !important;
            }
            
            .enlaces-container {
                flex-direction: column;
            }
        }
    </style>
</head>
<body>
    <div class="email-wrapper">
        <div class="email-container">
            <!-- Header con logo desde S3 -->
            <div class="header">
                ${logoUrl ? `
                    <img src="${logoUrl}" alt="${finalCompanyName}" class="logo" />
                ` : ''}
                <h1>${finalCompanyName}</h1>
            </div>
            
            <!-- Contenido principal -->
            <div class="content">
                <h2>Desprendibles de Nómina</h2>
                ${content}
                
                ${mensajeContextual ? `
                    <div class="mensaje-contextual">
                        <p>${mensajeContextual}</p>
                    </div>
                ` : ''}
                
                ${hasAttachments && !firmaDesprendible ? `
                    <div class="attachment-notice">
                        <p><strong>📎 Archivos Adjuntos:</strong> Revise los desprendibles adjuntos en este correo.</p>
                    </div>
                ` : ''}
                
                ${desprendiblesSection}
                
                ${hasAttachments && firmaDesprendible ? `
                    <div class="attachment-notice">
                        <p><strong>📎 Archivos Adjuntos:</strong> Algunos desprendibles están adjuntos en este correo, otros requieren firma digital usando los enlaces anteriores.</p>
                    </div>
                ` : ''}
            </div>
            
            <!-- Footer -->
            <div class="footer">
                <p><strong>Este es un mensaje automático</strong></p>
                <p>Por favor no responder directamente a este correo.</p>
                <p>Si tiene alguna pregunta, contacte a su supervisor o al departamento de recursos humanos.</p>
                <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
                <p>&copy; ${currentYear} ${finalCompanyName}. Todos los derechos reservados.</p>
                <p style="font-size: 11px; color: #9ca3af;">
                    Este correo electrónico y cualquier archivo adjunto son confidenciales y están destinados 
                    únicamente para el uso del destinatario previsto.
                </p>
            </div>
        </div>
    </div>
</body>
</html>`;
  return template;
}

/**
 * Función para enviar un correo electrónico
 * @param {Object} options - Opciones del correo
 * @returns {Promise<void>}
 */
async function sendEmail(options) {
  try {
    // Configurar el transporte de correo
    const transporterConfig = {
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === "true",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
      },
    };
    const transporter = nodemailer.createTransport(transporterConfig);

    // ===== PROCESAMIENTO DE ADJUNTOS =====
    let validAttachments = [];

    if (options.firmaDesprendible && !options.hasAttachments) {
      console.log("🚫 NO procesando adjuntos (solo enlaces de firma)");
    } else if (!options.attachments || !Array.isArray(options.attachments)) {
      console.log("⚠️ No hay adjuntos para procesar");
    } else {
      validAttachments = options.attachments.map((attachment, index) => {

        // Manejar diferentes tipos de contenido
        let content = attachment.content;

        // Si es un objeto serializado de Buffer
        if (content && typeof content === 'object' && content.type === 'Buffer') {
          content = Buffer.from(content.data || content);
        }

        // Verificar que es un Buffer válido
        if (Buffer.isBuffer(content) && content.length > 0) {
          return {
            filename: attachment.filename,
            content: content,
            contentType: attachment.contentType || 'application/pdf'
          };
        } else {
          console.log(`❌ Adjunto ${index + 1} inválido:`, attachment.filename);
          return null;
        }
      }).filter(Boolean);
    }

    // ===== CREAR CONTENIDO HTML =====
    const templateOptions = {
      logoFileName: options.logoFileName || 'codi.png',
      companyName: options.companyName || 'Transportes y Servicios Esmeralda S.A.S',
      showLogo: options.showLogo !== false,
      liquidacionId: options.liquidacionId,
      firmaDesprendible: options.firmaDesprendible,
      liquidacionesParaFirma: options.liquidacionesParaFirma || [],
      hasAttachments: options.hasAttachments || false,
      mensajeContextual: options.mensajeContextual || '',
      es_cotransmeq: options.es_cotransmeq || false
    };

    const htmlContent = createEmailTemplate(
      options.htmlContent || options.text,
      templateOptions
    );

    // ===== PREPARAR Y ENVIAR EMAIL =====
    const mailOptions = {
      from: `${options.fromName || 'Sistema de Nómina'} <${process.env.SMTP_USER}>`,
      to: options.to,
      subject: options.subject || 'Comprobante de Nómina',
      text: options.text || 'Por favor, visualice este correo en un cliente que soporte HTML.',
      html: htmlContent,
      attachments: validAttachments,
    };

    // Enviar el correo
    const result = await transporter.sendMail(mailOptions);

    return result;
  } catch (error) {
    console.error(`❌ Error al enviar correo a ${options.to}:`, error);
    console.error("🔍 Error details:", {
      message: error.message,
      code: error.code,
      stack: error.stack
    });
    throw error;
  }
}

/**
 * Función para generar un PDF a partir de una liquidación
 * @param {Object} liquidacion - Objeto de liquidación
 * @returns {Promise<Buffer>} - Buffer del PDF generado
 */
async function generatePDF(liquidacion) {
  return new Promise((resolve, reject) => {
    try {
      // Create a new PDFDocument with 6% larger size to accommodate more content
      const doc = new PDFDocument({
        margins: { top: 30, bottom: 15, left: 40, right: 40 },
        size: [631.00, 892.40], // A4 aumentado 6% (595.28 x 1.06, 841.89 x 1.06)
      });

      const recargosAgrupados = agruparRecargos(
        liquidacion.recargos_planilla,
        liquidacion.configuraciones_salario,
        {
          periodo_start: liquidacion.periodo_start,
          periodo_end: liquidacion.periodo_end,
          liquidacion_id: liquidacion.id,
          conductor_sede: liquidacion.conductor?.sede_trabajo || null
        }
      );

      // Collect data in chunks
      const chunks = [];
      doc.on("data", (chunk) => chunks.push(chunk));

      // Resolve promise when document is complete
      doc.on("end", () => {
        const pdfBuffer = Buffer.concat(chunks);
        resolve(pdfBuffer);
      });

      // Helper functions for common operations
      const safeValue = (value, defaultValue = "") => {
        return value !== undefined && value !== null
          ? typeof value === "string"
            ? value
            : parseInt(value)
          : defaultValue;
      };

      // Función para calcular la diferencia en días entre dos fechas
      const calcularDiferenciaDias = (fechaInicio, fechaFin) => {
        // Convertir strings a objetos Date
        const inicio = new Date(fechaInicio);
        const fin = new Date(fechaFin);

        // Calcular la diferencia en milisegundos
        const diferenciaMs = fin.getTime() - inicio.getTime();

        // Convertir milisegundos a días (1 día = 24 * 60 * 60 * 1000 ms)
        const diferenciaDias = Math.round(diferenciaMs / (24 * 60 * 60 * 1000));

        return diferenciaDias + 1;
      };

      const formatDate = (dateStr) => {
        if (!dateStr) return "";
        try {
          const date = new Date(dateStr);
          return date
            .toLocaleDateString("es-CO", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })
            .toUpperCase();
        } catch (e) {
          console.error("Error formatting date:", e);
          return dateStr;
        }
      };

      const getMesyAño = (dateStr) => {
        if (!dateStr) return "";
        try {
          const date = new Date(dateStr);
          return date
            .toLocaleDateString("es-CO", {
              month: "long",
              year: "numeric",
            })
            .toUpperCase();
        } catch (e) {
          console.error("Error formatting date:", e);
          return "";
        }
      };

      const obtenerDiferenciaDias = ({ start, end }) => {
        if (!start || !end) return 0;
        const startDate = new Date(start);
        const endDate = new Date(end);
        const diffTime = Math.abs(endDate - startDate);
        return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1; // +1 to include both start and end days
      };

      function formatDateShort(dateStr) {
        if (!dateStr) return "";

        try {
          const date = new Date(dateStr);

          // Obtener el día con dos dígitos
          const day = date.getDate().toString().padStart(2, "0");

          // Obtener el mes abreviado en minúsculas
          const month = date
            .toLocaleString("es", { month: "short" })
            .toLowerCase();

          // Devolver formato "DD-MMM"
          return `${day}-${month}`;
        } catch (error) {
          console.error("Error formatting date:", error);
          return "";
        }
      }

      function formatearHora(hora) {
        if (!hora) return "";

        return hora
          .replace(/\./g, ":") // Cambiar puntos por dos puntos
          .replace(/:50/g, ":30"); // Cambiar :50 por :30
      };

      // Filter recargos data
      const recargosParex =
        liquidacion?.recargos?.filter(
          (recargo) =>
            recargo.empresa_id === "cfb258a6-448c-4469-aa71-8eeafa4530ef"
        ) || [];

      const totalRecargosParex = recargosParex.reduce(
        (sum, recargo) => sum + (recargo.valor || 0),
        0
      );

      const recargosActualizados =
        liquidacion?.recargos?.filter(
          (recargo) =>
            recargo.empresa_id !== "cfb258a6-448c-4469-aa71-8eeafa4530ef"
        ) || [];

      const imagePath = path.join(
        __dirname,
        "..",
        "..",
        "public",
        "assets",
        "codi.png"
      );

      const imageX = 463; // 477 - 3% (477 * 0.97) = 463
      const imageY = 23; // 18 + 25% más abajo (18 * 1.25) = 22.5 ≈ 23

      // HEADER
      doc
        .fontSize(13)
        .fillColor("#2E8B57")
        .font("Helvetica-Bold")
        .text("TRANSPORTES Y SERVICIOS ESMERALDA S.A.S", {
          width: 300,
        });

      doc
        .fontSize(10)
        .fillColor("#000000")
        .font("Helvetica")
        .text("NIT: 901528440-3");

      doc.moveDown(1); // Mueve el cursor hacia abajo (alternativa a marginTop)

      doc
        .fontSize(11)
        .fillColor("#2E8B57")
        .font("Helvetica-Bold")
        .text(`COMPROBANTE DE NOMINA - ${getMesyAño(liquidacion.periodo_end)}`);

      doc.moveDown(1); // Mueve el cursor hacia abajo (alternativa a marginTop)

      doc
        .fontSize(11)
        .fillColor("#2E8B57")
        .font("Helvetica-Bold")
        .text(`BÁSICO CORRESPONDIENTE AL MES DE - ${getMesyAño(liquidacion.periodo_end)}`);

      // If you have a logo to insert
      doc.image(imagePath, imageX, imageY, {
        fit: [175, 100],
        align: "right",
        valign: "top",
      });

      doc.moveDown(1);

      // EMPLOYEE INFO TABLE
      const tableWidth = doc.page.width - 80;

      // Name
      drawTableRow(
        doc,
        "Nombre",
        `${safeValue(liquidacion.conductor?.nombre)} ${safeValue(
          liquidacion.conductor?.apellido
        )}`,
        {
          valueAlign: "right",
          rowHeight: 26,
          drawVerticalBorders: false,
          borderStyle: "outer",
        }
      );

      // ID
      drawTableRow(
        doc,
        "C.C.",
        safeValue(liquidacion.conductor?.numero_identificacion),
        {
          valueAlign: "right",
          rowHeight: 26,
          drawVerticalBorders: false,
          borderStyle: "outer",
        }
      );

      // Work days
      drawTableRow(
        doc,
        "Días laborados",
        safeValue(liquidacion.dias_laborados, "0"),
        {
          valueAlign: "right",
          rowHeight: 26,
          drawVerticalBorders: false,
          borderStyle: "outer",
        }
      );

      // Salary earned
      drawTableRow(
        doc,
        "Salario devengado",
        formatToCOP(safeValue(liquidacion.salario_devengado, "0")),
        {
          valueStyle: {
            color: "#007AFF",
            fontSize: 12,
            bgColor: "#F0F7FF",
            marginRight: 5,
          },
          valueAlign: "right",
          rowHeight: 26,
          drawVerticalBorders: false,
          borderStyle: "outer",
        }
      );

      // Transport subsidy
      drawTableRow(
        doc,
        "Auxilio de transporte",
        formatToCOP(safeValue(liquidacion.auxilio_transporte, "0")),
        {
          valueStyle: {
            color: "gray",
            fontSize: 12,
            bgColor: "#F0F0F0",
            marginRight: 5,
          },
          valueAlign: "right",
          rowHeight: 26,
          drawVerticalBorders: false,
          borderStyle: "outer",
        }
      );

      // Incapacidad remuneración - Solo mostrar si existe valor y es mayor a 0
      const valorIncapacidad = safeValue(liquidacion.valor_incapacidad, 0);
      if (valorIncapacidad > 0 && valorIncapacidad > 0) {
        drawTableRow(
          doc,
          "Remuneración por incapacidad",
          formatToCOP(valorIncapacidad),
          {
            middleText: `${safeValue(calcularDiferenciaDias(liquidacion.periodo_start_incapacidad, liquidacion.periodo_end_incapacidad), "0")} días`,
            middleAlign: "center",
            valueStyle: {
              color: "#2E8B57",
              fontSize: 12,
              bgColor: "#F3F8F5",
              marginRight: 5,
            },
            valueAlign: "right",
            rowHeight: 26,
            drawVerticalBorders: false,
            borderStyle: "outer",
          }
        );
      }

      // Adjustment
      drawTableRow(
        doc,
        "Ajuste villanueva",
        formatToCOP(safeValue(liquidacion.ajuste_salarial, "0")),
        {
          middleText: `${safeValue(
            liquidacion.dias_laborados_villanueva,
            "0"
          )} días`,
          middleAlign: "center",
          valueStyle: {
            color: "#FF9500",
            fontSize: 12,
            bgColor: "#FFF9F0",
            marginRight: 5,
          },
          valueAlign: "right",
          rowHeight: 26,
          drawVerticalBorders: false,
          borderStyle: "outer",
        }
      );

      doc.moveDown(2);

      // PERIODO
      doc
        .fontSize(13)
        .fillColor("#2E8B57")
        .font("Helvetica-Bold")
        .text(
          `ADICIONALES ${formatDate(liquidacion.periodo_start)} - ${formatDate(
            liquidacion.periodo_end
          )}`,
          {
            align: "center",
          }
        );

      doc.moveDown(1);

      // CONCEPTS TABLE
      // Table header
      const conceptsTop = doc.y;
      const col1Width = tableWidth * 0.28; // Reduce ligeramente
      const col2Width = tableWidth * 0.41; // Aumenta
      const col3Width = tableWidth * 0.14;
      const col4Width = tableWidth * 0.17; // Asegura que sea suficiente

      // Draw concepts table header
      doc.rect(40, conceptsTop, col1Width, 26);
      doc.rect(40 + col1Width, conceptsTop, col2Width, 26);
      doc.rect(40 + col1Width + col2Width, conceptsTop, col3Width, 26);
      doc.rect(
        40 + col1Width + col2Width + col3Width,
        conceptsTop,
        col4Width,
        26
      );

      doc
        .font("Helvetica-Bold")
        .fillAndStroke("#F3F8F5", "#E0E0E0")
        .fontSize(10)
        .fillColor("#2E8B57")
        .text("CONCEPTO", 48, conceptsTop + 8)
        .text("OBSERVACIÓN", 40 + col1Width + 8, conceptsTop + 8)
        .text("CANTIDAD", 40 + col1Width + col2Width + 8, conceptsTop + 8, {
          width: col3Width - 18,
          align: "center",
        })
        .text(
          "VALOR",
          40 + col1Width + col2Width + col3Width + 8,
          conceptsTop + 8,
          {
            width: col4Width - 18,
            align: "center",
          }
        );

      let currentY = conceptsTop + 26;

      function calculateRowHeight(text, fontSize, columnWidth) {
        // Estimar líneas necesarias basado en caracteres por línea
        const avgCharWidth = fontSize * 0.6; // Aproximación para Helvetica
        const charsPerLine = Math.floor((columnWidth - 16) / avgCharWidth); // -16 para padding
        const lines = Math.ceil(text.length / charsPerLine);
        return Math.max(24, lines * fontSize + 12); // +12 para padding vertical
      }


      // Helper function for concept table rows
      function drawConceptRow(
        concept,
        observation,
        quantity,
        value,
        options = {}
      ) {
        const {
          observationFontSize = 10,
        } = options;

        const rowHeight = observation.length > 40
          ? calculateRowHeight(observation, observationFontSize, col2Width)
          : 24;

        // Draw row background and borders
        doc.rect(40, currentY, col1Width, rowHeight).stroke("#E0E0E0");
        doc
          .rect(40 + col1Width, currentY, col2Width, rowHeight)
          .stroke("#E0E0E0");
        doc
          .rect(40 + col1Width + col2Width, currentY, col3Width, rowHeight)
          .stroke("#E0E0E0");
        doc
          .rect(
            40 + col1Width + col2Width + col3Width,
            currentY,
            col4Width,
            rowHeight
          )
          .stroke("#E0E0E0");

        // Write concept with normal size
        doc
          .fillColor("#000000")
          .font("Helvetica")
          .fontSize(12)
          .text(concept, 48, currentY + 8);

        // Observation with smaller font size and support for multiple lines
        // ¡AQUÍ ESTÁ EL CAMBIO PRINCIPAL!
        doc
          .fontSize(observationFontSize)
          .text(observation, 40 + col1Width + 8, currentY + 6, {
            width: col2Width - 16,  // Especificar el ancho disponible
            align: "left"           // Opcional: alineación
          });

        // Quantity column
        doc
          .fontSize(12)
          .text(quantity, 40 + col1Width + col2Width + 6, currentY + 8, {
            width: col3Width - 12,
            align: "center",
          });

        // Value column
        doc.text(
          value,
          40 + col1Width + col2Width + col3Width + 6,
          currentY + 8,
          {
            width: col4Width - 12,
            align: "center",
          }
        );

        currentY += rowHeight;
      }

      // Process bonificaciones - group by name
      if (liquidacion.bonificaciones && liquidacion.bonificaciones.length > 0) {
        // Group bonificaciones
        const bonificacionesGroup = {};

        liquidacion.bonificaciones.forEach((bonificacion) => {
          const totalQuantity = bonificacion.values.reduce(
            (sum, val) => sum + (val.quantity || 0),
            0
          );

          if (totalQuantity <= 0) return

          if (bonificacionesGroup[bonificacion.name]) {
            bonificacionesGroup[bonificacion.name].quantity += totalQuantity;
            bonificacionesGroup[bonificacion.name].totalValue +=
              totalQuantity * bonificacion.value;
          } else {
            bonificacionesGroup[bonificacion.name] = {
              name: bonificacion.name,
              quantity: totalQuantity,
              totalValue: totalQuantity * bonificacion.value,
            };
          }
        });

        // Draw bonificaciones rows
        Object.values(bonificacionesGroup).forEach((bono, index, array) => {
          const isLast =
            index === array.length - 1 &&
            recargosActualizados.length === 0 &&
            recargosParex.length === 0 &&
            (!liquidacion.pernotes || liquidacion.pernotes.length === 0);

          drawConceptRow(
            bono.name || "",
            "",
            bono.quantity,
            formatToCOP(bono.totalValue),
            { isLastRow: isLast }
          );
        });
      }

      // Recargos
      drawConceptRow(
        "Recargos",
        "Ver recargos detallados más adelante",
        "",
        formatToCOP(
          totalRecargosParex !== undefined &&
            liquidacion.total_recargos !== undefined
            ? liquidacion.total_recargos - totalRecargosParex
            : liquidacion.total_recargos || 0
        )
      );

      // Recargos PAREX if any
      if (recargosParex.length > 0) {
        const isLastRow =
          !liquidacion.pernotes || liquidacion.pernotes.length === 0;

        drawConceptRow(
          "Recargos PAREX",
          "Ver recargos detallados más adelante",
          "",
          formatToCOP(totalRecargosParex),
          { isLastRow }
        );
      }

      // Pernotes
      if (liquidacion.pernotes && liquidacion.pernotes.length > 0) {
        let pernoteText = "";
        try {
          // Función para agrupar fechas consecutivas
          const agruparFechasConsecutivas = (fechas) => {
            if (!fechas || fechas.length === 0) return [];

            // Convertir strings a objetos Date y ordenar
            const fechasOrdenadas = fechas
              .filter((f) => f)
              .map((f) => new Date(f))
              .sort((a, b) => a - b);

            const rangos = [];
            let rangoActual = {
              inicio: fechasOrdenadas[0],
              fin: fechasOrdenadas[0],
            };

            for (let i = 1; i < fechasOrdenadas.length; i++) {
              const fechaActual = fechasOrdenadas[i];
              const fechaAnterior = fechasOrdenadas[i - 1];

              // Verificar si son consecutivas (diferencia de 1 día)
              const diffTime = Math.abs(fechaActual - fechaAnterior);
              const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

              if (diffDays === 1) {
                // Son consecutivas, extender el rango actual
                rangoActual.fin = fechaActual;
              } else {
                // No son consecutivas, guardar el rango actual y empezar uno nuevo
                rangos.push(rangoActual);
                rangoActual = { inicio: fechaActual, fin: fechaActual };
              }
            }

            // Añadir el último rango
            rangos.push(rangoActual);

            // Formatear rangos
            return rangos.map((rango) => {
              const inicioStr = formatDateShort(rango.inicio);
              const finStr = formatDateShort(rango.fin);

              return inicioStr === finStr
                ? inicioStr // Fecha individual
                : `${inicioStr}~${finStr}`; // Rango
            });
          };

          // Recopilar todas las fechas y agruparlas
          const todasLasFechas = [];
          liquidacion.pernotes.forEach((pernote) => {
            if (pernote.fechas && pernote.fechas.length > 0) {
              todasLasFechas.push(...pernote.fechas);
            }
          });

          const rangos = agruparFechasConsecutivas(todasLasFechas);
          pernoteText = rangos.join(", ");
        } catch (error) {
          console.error("Error formatting pernote date:", error);
        }

        // Calculate total pernotes
        const totalPernotes = liquidacion.pernotes.reduce(
          (total, pernote) =>
            total + (pernote.fechas ? pernote.fechas.length : 0),
          0
        );

        drawConceptRow(
          "Pernotes",
          pernoteText,
          totalPernotes || "0",
          formatToCOP(safeValue(liquidacion.total_pernotes, "0")),
          {
            isLastRow: true,
          }
        );
      } else {
        drawConceptRow("Pernotes", "", "0", formatToCOP(0), {
          isLastRow: true,
        });
      }

      // Reset for deductions table
      currentY = doc.y;

      doc.moveDown(2);

      // CONCEPTOS ADICIONALES (si existen)
      if (
        liquidacion.conceptos_adicionales &&
        Array.isArray(liquidacion.conceptos_adicionales) &&
        liquidacion.conceptos_adicionales.length > 0
      ) {

        // Título con línea separadora
        doc
          .font("Helvetica-Bold")
          .fontSize(12)
          .fillColor("#2E8B57")
          .text("CONCEPTOS ADICIONALES", 40, doc.y, {
            width: doc.page.width - 80,
            align: "left",
          });

        liquidacion.conceptos_adicionales.forEach((concepto, index) => {
          const additionalConceptsTop = doc.y;
          const col1Width = tableWidth * 0.28;
          const col2Width = tableWidth * 0.41; 
          const col3Width = tableWidth * 0.14;
          const col4Width = tableWidth * 0.17;

          let currentAdditionalY = additionalConceptsTop + 10;

          liquidacion.conceptos_adicionales.forEach((concepto, index) => {
            const cantidad = concepto.cantidad ? concepto.cantidad : "1";
            const rowHeight = 32;

            // Draw row background and borders
            doc.rect(40, currentAdditionalY, col1Width, rowHeight).stroke("#E0E0E0");
            doc
              .rect(40 + col1Width, currentAdditionalY, col2Width, rowHeight)
              .stroke("#E0E0E0");
            doc
              .rect(40 + col1Width + col2Width, currentAdditionalY, col3Width, rowHeight)
              .stroke("#E0E0E0");
            doc
              .rect(
                40 + col1Width + col2Width + col3Width,
                currentAdditionalY,
                col4Width,
                rowHeight
              )
              .stroke("#E0E0E0");

            // Write concept name
            doc
              .fillColor("#000000")
              .font("Helvetica")
              .fontSize(12)
              .text(concepto.nombre || "Ajuste adicional", 48, currentAdditionalY + 8);

            // Observation with smaller font size
            doc
              .fontSize(10)
              .text(concepto.observaciones || "", 40 + col1Width + 8, currentAdditionalY + 6, {
                width: col2Width - 16,
                align: "left"
              });

            // Quantity column
            doc
              .fontSize(12)
              .text(cantidad, 40 + col1Width + col2Width + 6, currentAdditionalY + 8, {
                width: col3Width - 12,
                align: "center",
              });

            // Value column
            // Verificar si el valor es positivo o negativo para el símbolo
            const valorConcepto = parseFloat(concepto.valor) || 0;
            const simbolo = valorConcepto > 0 ? "+" : (valorConcepto < 0 ? "-" : "");
            const valorAbsoluto = Math.abs(valorConcepto);
            const textoValor = simbolo + formatToCOP(valorAbsoluto);

            // Calcular ancho del texto para el fondo
            const anchoTexto = doc.widthOfString(textoValor) + 16;
            const bordeDerechoColumna = 40 + col1Width + col2Width + col3Width + col4Width;

            // Dibujar fondo similar al salario total
            doc
              .roundedRect(
              bordeDerechoColumna - anchoTexto - 8,
              currentAdditionalY + 4,
              anchoTexto,
              rowHeight - 8,
              3
              )
              .fill("#F3F8F5");

            // Calcular posicionamiento centrado
            const alturaTexto = 20; // Altura limitada para el texto
            const centroX = 40 + col1Width + col2Width + col3Width + (col4Width / 2);
            const centroY = currentAdditionalY + (rowHeight / 2);
            
            // Dibujar fondo centrado con altura limitada
            doc
              .roundedRect(
              centroX - (anchoTexto / 2),
              centroY - (alturaTexto / 2),
              anchoTexto,
              alturaTexto,
              3
              )
              .fill("#F3F8F5");

            // Texto centrado dentro del fondo
            doc
              .fontSize(12)
              .fillColor("#2E8B57")
              .text(
              textoValor,
              centroX - (anchoTexto / 2),
              centroY - 6, // Ajuste vertical para centrar el texto
              {
                width: anchoTexto,
                align: "center",
              }
              );

            currentAdditionalY += rowHeight;
          });

          // Actualizar la posición Y del documento
          doc.y = currentAdditionalY;
        });

        doc.moveDown(1.2); // Separación limpia antes de deducciones
      }


      // DEDUCCIONES
      doc
        .fontSize(12)
        .fillColor("#2E8B57")
        .font("Helvetica-Bold")
        .text(
          "DEDUCCIONES",
          40, // Posición x (izquierda)
          doc.y, // Posición y (mantener la posición actual)
          {
            width: doc.page.width - 80, // Ancho (restando márgenes)
            align: "left",
          }
        );

      doc.moveDown(1);

      // Salud
      drawTableRow(
        doc,
        "Salud",
        formatToCOP(safeValue(liquidacion.salud, "0")),
        {
          valueStyle: {
            color: "#e60f0f",
            fontSize: 12,
            bgColor: "#FDF1F1",
            marginRight: 5,
          },
          valueAlign: "right",
          rowHeight: 26,
          borderStyle: "outer",
        }
      );

      // Pensión
      drawTableRow(
        doc,
        "Pensión",
        formatToCOP(safeValue(liquidacion.pension, "0")),
        {
          valueStyle: {
            color: "#e60f0f",
            fontSize: 12,
            bgColor: "#FDF1F1",
            marginRight: 5,
          },
          valueAlign: "right",
          rowHeight: 26,
          borderStyle: "outer",
        }
      );

      // Anticipos (if applicable)
      if (liquidacion.anticipos && liquidacion.anticipos.length > 0) {
        drawTableRow(
          doc,
          "Anticipos",
          formatToCOP(safeValue(liquidacion.total_anticipos, "0")),
          {
            valueStyle: {
              color: "#e60f0f",
              fontSize: 12,
              bgColor: "#FDF1F1",
              marginRight: 5,
            },
            valueAlign: "right",
            rowHeight: 26,
            borderStyle: "outer",
          }
        );
      }

      doc.moveDown(1.5);

      // PERIOD
      doc
        .fontSize(12)
        .fillColor("#2E8B57")
        .font("Helvetica-Bold")
        .text(
          "RESUMEN FINAL",
          40, // Posición x (izquierda)
          doc.y, // Posición y (mantener la posición actual)
          {
            width: doc.page.width - 80, // Ancho (restando márgenes)
            align: "left",
          }
        );

      doc.moveDown(1);

      if (safeValue(liquidacion.total_vacaciones, "0") > 0) {
        const vacationDays =
          liquidacion.periodo_start_vacaciones &&
            liquidacion.periodo_end_vacaciones
            ? obtenerDiferenciaDias({
              start: liquidacion.periodo_start_vacaciones,
              end: liquidacion.periodo_end_vacaciones,
            })
            : 0;

        drawTableRow(
          doc,
          "Vacaciones",
          formatToCOP(safeValue(liquidacion.total_vacaciones, "0")),
          {
            middleText: `${vacationDays} días`,
            middleAlign: "center",
            valueStyle: {
              color: "#FF9500",
              fontSize: 12,
              bgColor: "#FFF9F0",
              marginRight: 5,
            },
            valueAlign: "right",
            rowHeight: 26,
            borderStyle: "outer",
          }
        );
      }

      // Interés Cesantías (if applicable)
      if (safeValue(liquidacion.interes_cesantias, "0") > 0) {
        drawTableRow(
          doc,
          "Interes cesantias",
          formatToCOP(safeValue(liquidacion.interes_cesantias, "0")),
          {
            valueStyle: {
              color: "#007AFF",
              fontSize: 12,
              bgColor: "#F0F7FF",
              marginRight: 5,
            },
            valueAlign: "right",
            rowHeight: 26,
            borderStyle: "outer",
          }
        );
      }

      // TOTAL SECTION
      drawTableRow(
        doc,
        "Salario total",
        formatToCOP(safeValue(liquidacion.sueldo_total, "0")),
        {
          headerStyle: { fontSize: 12 },
          valueStyle: {
            color: "#2E8B57",
            fontSize: 12,
            bgColor: "#F3F8F5",
            marginRight: 5,
          },
          rowHeight: 26,
          valueAlign: "right",
          borderStyle: "outer",
        }
      );

      // FOOTER
      const footerTop = doc.page.height - 30;
      doc
        .fontSize(10)
        .fillColor("#9E9E9E")
        .font("Helvetica")
        .text(
          `Documento generado el ${new Date().toLocaleDateString()}`,
          40,
          footerTop,
          {
            align: "center",
            width: doc.page.width - 80,
          }
        );


      // ============ SECCIÓN DE RECARGOS AGRUPADOS CORREGIDA ============
      // Agregar esta lógica justo ANTES del doc.end() en tu función generatePDF:

      if (recargosAgrupados && Array.isArray(recargosAgrupados) && recargosAgrupados.length > 0) {
        let esPrimerGrupo = true;

        // Función helper para formatear hora
        function formatearHora(hora) {
          if (!hora) return "00:00";

          // Si ya es un string con formato de hora, devolverlo tal como está
          if (typeof hora === 'string' && hora.includes(':')) return hora;

          // Si es un número (ej: 8.5)
          if (typeof hora === 'number') {
            const horas = Math.floor(hora);
            const decimales = hora - horas;

            // Convertir decimales a minutos (0.5 = 30 minutos, 0.25 = 15 minutos, etc.)
            const minutos = Math.round(decimales * 60);

            return `${horas.toString().padStart(2, '0')}:${minutos.toString().padStart(2, '0')}`;
          }

          // Si es un string que representa un número (ej: "8.5")
          if (typeof hora === 'string') {
            const numeroHora = parseFloat(hora);
            if (!isNaN(numeroHora)) {
              const horas = Math.floor(numeroHora);
              const decimales = numeroHora - horas;
              const minutos = Math.round(decimales * 60);

              return `${horas.toString().padStart(2, '0')}:${minutos.toString().padStart(2, '0')}`;
            }
          }

          return hora.toString();
        }

        // Procesar cada grupo individualmente SIN sistema de páginas automático
        recargosAgrupados.forEach((grupo, indiceGrupo) => {
          const recargosArray = grupo.recargos || grupo.items || grupo.data || [];
          if (recargosArray.length === 0) {
            console.warn(`Grupo ${indiceGrupo} no tiene recargos válidos`);
            return;
          }

          // Calcular altura necesaria ANTES de renderizar
          const alturaGrupo = calcularAlturaGrupoPDF(doc, grupo);

          let yActual;

          const tableWidth = doc.page.width - 80;

          // 4. Filas de datos (SIN control de páginas interno) - mostrar días repetidos y marcar disponibilidad
          const diasFuente = (grupo.dias_laborales && Array.isArray(grupo.dias_laborales) ? grupo.dias_laborales
            : (grupo.dias && Array.isArray(grupo.dias) ? grupo.dias
              : (grupo.dias_laborales_unificados && Array.isArray(grupo.dias_laborales_unificados) ? grupo.dias_laborales_unificados : [])));

          const hayDiasFestivosODomingos = diasFuente.some(d => d && ((d.es_festivo === true) || (d.es_domingo === true)));
          const hayDiasDisponibles = diasFuente.some(d => d && (d.disponibilidad === true || d.es_disponible === true));

          // Control de páginas unificado
          if (esPrimerGrupo) {
            // Primera vez: crear página con título
            doc.addPage();
            doc
              .fontSize(12)
              .fillColor("#2E8B57")
              .font("Helvetica-Bold")
              .text('HORAS EXTRAS Y RECARGOS', 40, 30, {
                align: "center"
              });
            yActual = 55;


            // Aviso sobre días dominicales o festivos
            if (hayDiasFestivosODomingos) {
              doc
                .font("Helvetica-Bold")
                .fontSize(9)
                .fillColor("#92400E")
                .text("Aviso: Los días dominicales o festivos se resaltan en naranja.", 40, yActual + 6, {
                  width: tableWidth,
                  align: 'left'
                });
              yActual += 20;
            }

            if (hayDiasDisponibles) {
              doc
                .font("Helvetica-Bold")
                .fontSize(9)
                .fillColor("#B91C1C")
                .text("Aviso: Los días marcados como disponibilidad no son reconocidos. Se muestran en rojo y no suman a los totales.", 40, yActual + 6, {
                  width: tableWidth,
                  align: 'left'
                });
              yActual += 20;
            }

            esPrimerGrupo = false;
          } else {
            // Grupos siguientes: verificar si cabe en página actual
            const espacioDisponible = doc.page.height - doc.y - 60; // Margen inferior

            if (alturaGrupo > espacioDisponible) {
              // No cabe: crear nueva página
              doc.addPage();
              yActual = 50;
            } else {
              // Sí cabe: continuar en página actual
              yActual = doc.y + 30;
            }
          }

          // === RENDERIZAR GRUPO COMPLETO (SIN MÁS CONTROLES DE PÁGINA) ===

          // 1. Encabezado del vehículo
          doc.rect(40, yActual, tableWidth, 25)
            .fillAndStroke("#2E8B57", "#E0E0E0");

          doc
            .font("Helvetica-Bold")
            .fontSize(10)
            .fillColor("#fff")
            .text(`VEHÍCULO: ${grupo.vehiculo.placa}`, 45, yActual + 8)
            .text(`MES: ${new Date(grupo.año, grupo.mes - 1).toLocaleString("es-ES", {
              month: "long",
            }).toUpperCase()}`, 40, yActual + 8, {
              width: tableWidth - 10,
              align: 'right',
            });

          yActual += 25;

          // 2. Información de empresa
          const infoHeight = 40;
          doc.rect(40, yActual, tableWidth, infoHeight)
            .fillAndStroke("#f9f9f9", "#cccccc");

          doc
            .font("Helvetica-Bold")
            .fontSize(11)
            .fillColor("#000000")
            .text(`EMPRESA: `, 45, yActual + 8, { continued: true })
            .font("Helvetica")
            .text(`${grupo.empresa.nombre}`, {
              width: tableWidth - 50,  // Ancho máximo respetando los márgenes
              align: 'left'
            });

          doc
            .font("Helvetica")
            .fontSize(11)
            .fillColor("#666666")
            .text(`Valor/Hora Base: $${Math.round(grupo.valor_hora_base).toLocaleString()}`, 45, yActual + 25);

          yActual += infoHeight;

          // 3. Encabezados de columnas
          const totalColumnas = 9; // CORREGIDO: son 9 columnas, no 10
          const anchoBase = tableWidth / (totalColumnas + 0.5); // 0.5 extra para HORARIO

          const colDia = anchoBase;
          const colHorario = anchoBase * 1.5;
          const colHoras = anchoBase;
          const colHED = anchoBase;
          const colRN = anchoBase;
          const colHEN = anchoBase;
          const colRD = anchoBase;
          const colHEFD = anchoBase;
          const colHEFN = anchoBase;

          let xPos = 40;

          const encabezados = [
            { texto: 'DÍA', ancho: colDia },
            { texto: 'HORARIO', ancho: colHorario },
            { texto: 'HORAS', ancho: colHoras },
            { texto: 'HED', ancho: colHED },
            { texto: 'RN', ancho: colRN },
            { texto: 'HEN', ancho: colHEN },
            { texto: 'RD', ancho: colRD },
            { texto: 'HEFD', ancho: colHEFD },
            { texto: 'HEFN', ancho: colHEFN }
          ];

          encabezados.forEach(encabezado => {
            doc.rect(xPos, yActual, encabezado.ancho, 25)
              .fillAndStroke("#F3F8F5", "#E0E0E0");

            doc
              .font("Helvetica-Bold")
              .fontSize(10)
              .fillColor("#2E8B57")
              .text(
                encabezado.texto,
                xPos,
                yActual + 8,
                {
                  width: encabezado.ancho,
                  align: 'center'
                }
              );

            xPos += encabezado.ancho;
          });

          yActual += 25;

          const totalesVisibles = {
            total_dias: 0,
            total_horas: 0,
            total_hed: 0,
            total_rn: 0,
            total_hen: 0,
            total_rd: 0,
            total_hefd: 0,
            total_hefn: 0
          };

          const filasRender = diasFuente.filter(d => d);

          filasRender.forEach((dia, diaIndex) => {
            let xPos = 40;
            const rowHeight = 20;

            const esDisponible = dia.disponibilidad === true || dia.es_disponible === true;
            const esEspecial = dia.es_domingo === true || dia.es_festivo === true;

            const vTotal = parseFloat(dia.total_horas) || 0;
            const vHED = parseFloat(dia.hed) || 0;
            const vRN = parseFloat(dia.rn) || 0;
            const vHEN = parseFloat(dia.hen) || 0;
            const vRD = parseFloat(dia.rd) || 0;
            const vHEFD = parseFloat(dia.hefd) || 0;
            const vHEFN = parseFloat(dia.hefn) || 0;

            const mostrarTotal = esDisponible ? 0 : vTotal;
            const mostrarHED = esDisponible ? 0 : vHED;
            const mostrarRN = esDisponible ? 0 : vRN;
            const mostrarHEN = esDisponible ? 0 : vHEN;
            const mostrarRD = esDisponible ? 0 : vRD;
            const mostrarHEFD = esDisponible ? 0 : vHEFD;
            const mostrarHEFN = esDisponible ? 0 : vHEFN;

            if (!esDisponible) {
              totalesVisibles.total_dias += 1;
              totalesVisibles.total_horas += mostrarTotal;
              totalesVisibles.total_hed += mostrarHED;
              totalesVisibles.total_rn += mostrarRN;
              totalesVisibles.total_hen += mostrarHEN;
              totalesVisibles.total_rd += mostrarRD;
              totalesVisibles.total_hefd += mostrarHEFD;
              totalesVisibles.total_hefn += mostrarHEFN;
            }

            const datosColumnas = [
              { valor: dia.dia, ancho: colDia },
              { valor: `${formatearHora(dia.hora_inicio)}-${formatearHora(dia.hora_fin)}`, ancho: colHorario },
              { valor: mostrarTotal, ancho: colHoras },
              { valor: mostrarHED !== 0 ? `${mostrarHED}` : "-", ancho: colHED },
              { valor: mostrarRN !== 0 ? `${mostrarRN}` : "-", ancho: colRN },
              { valor: mostrarHEN !== 0 ? `${mostrarHEN}` : "-", ancho: colHEN },
              { valor: mostrarRD !== 0 ? `${mostrarRD}` : "-", ancho: colRD },
              { valor: mostrarHEFD !== 0 ? `${mostrarHEFD}` : "-", ancho: colHEFD },
              { valor: mostrarHEFN !== 0 ? `${mostrarHEFN}` : "-", ancho: colHEFN }
            ];

            datosColumnas.forEach((columna) => {
              const colorFondoBase = diaIndex % 2 === 0 ? "#ffffff" : "#f9f9f9";
              // Rojo claro para disponibilidad, Naranja claro para dominical/festivo
              const colorFondo = esDisponible ? "#FEE2E2" : (esEspecial ? "#FEF3C7" : colorFondoBase);

              doc.rect(xPos, yActual, columna.ancho, rowHeight)
                .fillAndStroke(colorFondo, "#E0E0E0");

              doc
                .font("Helvetica")
                .fontSize(9)
                .fillColor(esDisponible ? "#B91C1C" : (esEspecial ? "#92400E" : "#333333"))
                .text(
                  columna.valor.toString(),
                  xPos,
                  yActual + 6,
                  {
                    width: columna.ancho,
                    align: 'center'
                  }
                );

              xPos += columna.ancho;
            });

            yActual += rowHeight;
          });

          // 5. Totales consolidados
          function formatearTotal(valor) {
            if (valor === null || valor === undefined || valor === 0) {
              return "-";
            }
            return typeof valor === 'number' ? valor.toFixed(1) : valor.toString();
          }

          // Encabezado de totales
          const totalHeaderHeight = 25;
          doc.rect(40, yActual, tableWidth, totalHeaderHeight)
            .fillAndStroke("#F3F8F5", "#E0E0E0");

          doc
            .font("Helvetica-Bold")
            .fontSize(11)
            .fillColor("#2E8B57")
            .text("TOTALES CONSOLIDADOS", 40, yActual + 8, {
              width: tableWidth,
              align: 'center'
            });

          yActual += totalHeaderHeight;

          // Fila de datos de totales
          let positionX = 40;
          const rowHeight = 22;

          const totalesData = [
            totalesVisibles.total_dias,
            "-",
            formatearTotal(totalesVisibles.total_horas),
            formatearTotal(totalesVisibles.total_hed),
            formatearTotal(totalesVisibles.total_rn),
            formatearTotal(totalesVisibles.total_hen),
            formatearTotal(totalesVisibles.total_rd),
            formatearTotal(totalesVisibles.total_hefd),
            formatearTotal(totalesVisibles.total_hefn)
          ];

          const anchosColumnas = [colDia, colHorario, colHoras, colHED, colRN, colHEN, colRD, colHEFD, colHEFN];

          totalesData.forEach((total, colIndex) => {
            doc.rect(positionX, yActual, anchosColumnas[colIndex], rowHeight)
              .fillAndStroke("#ffffff", "#E0E0E0");

            doc
              .font("Helvetica-Bold")
              .fontSize(10)
              .fillColor("#2E8B57")
              .text(
                total,
                positionX + 2,
                yActual + 6,
                {
                  width: anchosColumnas[colIndex] - 4,
                  align: 'center'
                }
              );

            positionX += anchosColumnas[colIndex];
          });

          yActual += rowHeight;

          // 6. Tipos de recargos (si existen) - recalculados excluyendo días de disponibilidad
          if (grupo.tipos_recargos_consolidados && grupo.tipos_recargos_consolidados.length > 0) {
            const horasPorCodigo = { HED: 0, RN: 0, HEN: 0, RD: 0, HEFD: 0, HEFN: 0 };
            filasRender.forEach(dia => {
              const esDisponible = dia.disponibilidad === true || dia.es_disponible === true;
              if (esDisponible) return;
              horasPorCodigo.HED += parseFloat(dia.hed) || 0;
              horasPorCodigo.RN += parseFloat(dia.rn) || 0;
              horasPorCodigo.HEN += parseFloat(dia.hen) || 0;
              horasPorCodigo.RD += parseFloat(dia.rd) || 0;
              horasPorCodigo.HEFD += parseFloat(dia.hefd) || 0;
              horasPorCodigo.HEFN += parseFloat(dia.hefn) || 0;
            });

            const metaPorCodigo = {};
            grupo.tipos_recargos_consolidados.forEach(tipo => { if (tipo && tipo.codigo) metaPorCodigo[tipo.codigo] = tipo; });

            const tiposConsolidadosVisibles = Object.keys(horasPorCodigo).map(codigo => {
              const meta = metaPorCodigo[codigo] || {};
              const horas = horasPorCodigo[codigo] || 0;
              const valorHoraBase = meta.valor_hora_base || grupo.valor_hora_base || 0;
              const valorHoraConRecargo = meta.valor_hora_con_recargo || valorHoraBase;
              const porcentaje = meta.porcentaje || 0;
              const nombre = meta.nombre || (meta.codigo || '').toUpperCase();
              const valorCalculado = horas * valorHoraConRecargo;
              return { nombre, codigo, porcentaje, valor_hora_base: valorHoraBase, valor_hora_con_recargo: valorHoraConRecargo, horas, valor_calculado: valorCalculado };
            }).filter(item => item.horas !== 0);
            const tipoRecargosWidth = tableWidth;

            // Calcular ancho base de una columna (igual que en la tabla de días)
            const totalColumnas = 9;
            const anchoBase = tableWidth / (totalColumnas + 0.5);

            // TIPO RECARGO ocupa 4 columnas equivalentes, el resto 1 columna cada una
            const col1 = anchoBase * 4.5;     // TIPO RECARGO (4 columnas)
            const col2 = anchoBase;         // %
            const col3 = anchoBase;         // V/BASE
            const col4 = anchoBase;         // V/+ %
            const col5 = anchoBase;         // CANTIDAD
            const col6 = anchoBase;         // TOTAL

            // Encabezado de tipos de recargos
            const headerHeight = 25;
            let xPos = 40;

            const encabezadosRecargos = [
              { texto: 'TIPO RECARGO', ancho: col1 },
              { texto: '%', ancho: col2 },
              { texto: 'V/BASE', ancho: col3 },
              { texto: 'V/+ %', ancho: col4 },
              { texto: 'CANTIDAD', ancho: col5 },
              { texto: 'TOTAL', ancho: col6 }
            ];

            encabezadosRecargos.forEach(encabezado => {
              doc.rect(xPos, yActual, encabezado.ancho, headerHeight)
                .fillAndStroke("#F3F8F5", "#E0E0E0");

              doc
                .font("Helvetica-Bold")
                .fontSize(9)
                .fillColor("#2E8B57")
                .text(
                  encabezado.texto,
                  xPos + 5,
                  yActual + 8,
                  {
                    width: encabezado.ancho - 6,
                    align: encabezado.texto === 'TIPO RECARGO' ? 'left' : 'center'
                  }
                );

              xPos += encabezado.ancho;
            });

            yActual += headerHeight;

            // Filas de tipos de recargos visibles (excluyendo disponibilidad)
            tiposConsolidadosVisibles.forEach((tipo, tipoIndex) => {
              xPos = 40;
              const rowHeight = 20;

              const filaDatos = [
                {
                  texto: (tipo.nombre || '').toUpperCase(),
                  ancho: col1,
                  align: 'left',
                  color: '#333333',
                  colorCodigo: '#007AFF',
                  codigo: tipo.codigo
                },
                {
                  texto: `${tipo.porcentaje}%`,
                  ancho: col2,
                  align: 'center',
                  color: '#333333'
                },
                {
                  texto: `$${Math.round(tipo.valor_hora_base).toLocaleString()}`,
                  ancho: col3,
                  align: 'center',
                  color: '#666666'
                },
                {
                  texto: `$${Math.round(tipo.valor_hora_con_recargo).toLocaleString()}`,
                  ancho: col4,
                  align: 'center',
                  color: '#2E8B57'
                },
                {
                  texto: tipo.horas.toString(),
                  ancho: col5,
                  align: 'center',
                  color: '#333333'
                },
                {
                  texto: `$${Math.round(tipo.valor_calculado).toLocaleString()}`,
                  ancho: col6,
                  align: 'center',
                  color: '#333333'
                }
              ];

              filaDatos.forEach((celda, colIndex) => {
                doc.rect(xPos, yActual, celda.ancho, rowHeight)
                  .fillAndStroke("#ffffff", "#E0E0E0");

                if (colIndex === 0) {
                  // Nombre del tipo de recargo
                  doc
                    .font("Helvetica")
                    .fontSize(9)
                    .fillColor(celda.color)
                    .text(celda.texto, xPos + 5, yActual + 5);

                  // Código en azul
                  if (celda.codigo) {
                    const textoAncho = doc.widthOfString(celda.texto + " - ");
                    doc
                      .fillColor(celda.colorCodigo)
                      .text(`- ${celda.codigo}`, xPos + textoAncho, yActual + 5);
                  }
                } else {
                  // Otras columnas
                  doc
                    .font(colIndex === 3 || colIndex === 5 ? "Helvetica-Bold" : "Helvetica")
                    .fontSize(10)
                    .fillColor(celda.color)
                    .text(
                      celda.texto,
                      xPos + 3,
                      yActual + 5,
                      {
                        width: celda.ancho - 6,
                        align: celda.align
                      }
                    );
                }

                xPos += celda.ancho;
              });

              yActual += rowHeight;
            });

            // TOTAL recalculado sólo con visibles
            const total = 25;
            doc.rect(40, yActual, tipoRecargosWidth, total)
              .fillAndStroke("#2E8B57", "#E0E0E0");

            doc
              .font("Helvetica-Bold")
              .fontSize(10)
              .fillColor("#ffffff")
              .text("TOTAL", 45, yActual + 8)
              .text(`$${Math.round(tiposConsolidadosVisibles.reduce((acc, t) => acc + (t.valor_calculado || 0), 0)).toLocaleString()}`, 40, yActual + 8, {
                width: tipoRecargosWidth - 6,
                align: 'right'
              });

            yActual += total;
          }

          // Actualizar posición Y del documento para el siguiente grupo
          doc.y = yActual + 20;
        });
      } else {
        console.log('No se encontraron recargos agrupados para procesar');
      }

      // Finish the PDF
      doc.end();
    } catch (error) {
      console.error("Error generating PDF:", error);
      reject(error);
    }
  });
}

/**
 * Helper function to draw a table row
 * @param {PDFDocument} doc - The PDFKit document
 * @param {string} label - The row label
 * @param {string} value - The row value
 * @param {Object} options - Additional options
 */
function drawTableRow(doc, label, value, options = {}) {
  const {
    headerStyle = {},
    valueStyle = {},
    middleText = "",
    middleAlign = "left",
    valueAlign = "left",
    rowHeight = 26,
    drawBorder = true,
    isLastRow = false,
    drawVerticalBorders = false, // Nuevo parámetro para controlar bordes verticales
    borderStyle = "full", // Nuevo parámetro: "full", "horizontal", "outer", etc.
  } = options;

  const currentY = doc.y;
  const tableWidth = doc.page.width - 80;

  // Draw borders if needed
  if (drawBorder) {
    // Dibujar solo la línea horizontal superior
    doc
      .moveTo(40, currentY)
      .lineTo(40 + tableWidth, currentY)
      .stroke("#E0E0E0");

    // Dibujar la línea horizontal inferior (solo si no es la última fila)
    if (!isLastRow) {
      doc
        .moveTo(40, currentY + rowHeight)
        .lineTo(40 + tableWidth, currentY + rowHeight)
        .stroke("#E0E0E0");
    }

    // Dibujar líneas verticales solo si se solicita
    if (drawVerticalBorders) {
      if (middleText) {
        // Three-column layout
        const col1Width = tableWidth * 0.4;
        const col2Width = tableWidth * 0.3;

        // Línea vertical después de col1
        doc
          .moveTo(40 + col1Width, currentY)
          .lineTo(40 + col1Width, currentY + rowHeight)
          .stroke("#E0E0E0");

        // Línea vertical después de col2
        doc
          .moveTo(40 + col1Width + col2Width, currentY)
          .lineTo(40 + col1Width + col2Width, currentY + rowHeight)
          .stroke("#E0E0E0");
      } else {
        // Two-column layout
        const col1Width = tableWidth * 0.4;

        // Línea vertical después de col1
        doc
          .moveTo(40 + col1Width, currentY)
          .lineTo(40 + col1Width, currentY + rowHeight)
          .stroke("#E0E0E0");
      }

      // Líneas verticales en los bordes exteriores
      doc
        .moveTo(40, currentY)
        .lineTo(40, currentY + rowHeight)
        .stroke("#E0E0E0");
      doc
        .moveTo(40 + tableWidth, currentY)
        .lineTo(40 + tableWidth, currentY + rowHeight)
        .stroke("#E0E0E0");
    }
  }

  if (borderStyle === "full") {
    // Dibujar todos los bordes verticales (estilo original)
    if (middleText) {
      const col1Width = tableWidth * 0.4;
      const col2Width = tableWidth * 0.3;

      doc
        .moveTo(40 + col1Width, currentY)
        .lineTo(40 + col1Width, currentY + rowHeight)
        .stroke("#E0E0E0");
      doc
        .moveTo(40 + col1Width + col2Width, currentY)
        .lineTo(40 + col1Width + col2Width, currentY + rowHeight)
        .stroke("#E0E0E0");
    } else {
      const col1Width = tableWidth * 0.4;
      doc
        .moveTo(40 + col1Width, currentY)
        .lineTo(40 + col1Width, currentY + rowHeight)
        .stroke("#E0E0E0");
    }
  }

  // Siempre dibujar los bordes exteriores (izquierda y derecha)
  if (borderStyle === "outer" || borderStyle === "full") {
    // Borde izquierdo
    doc
      .moveTo(40, currentY)
      .lineTo(40, currentY + rowHeight)
      .stroke("#E0E0E0");
    // Borde derecho
    doc
      .moveTo(40 + tableWidth, currentY)
      .lineTo(40 + tableWidth, currentY + rowHeight)
      .stroke("#E0E0E0");
  }

  // Resto del código sin cambios...
  // Draw header text
  doc.fillColor("#000000").fontSize(12);
  if (headerStyle.bold) {
    doc.font("Helvetica-Bold");
  } else {
    doc.font("Helvetica");
  }

  if (headerStyle.fontSize) {
    doc.fontSize(headerStyle.fontSize);
  }

  doc.text(label, 48, currentY + 8);

  // Draw middle text if provided
  if (middleText) {
    doc.font("Helvetica").fontSize(12);

    const middleX = 40 + tableWidth * 0.4;
    const middleWidth = tableWidth * 0.3;

    if (middleAlign === "center") {
      doc.text(middleText, middleX, currentY + 8, {
        width: middleWidth,
        align: "center",
      });
    } else {
      doc.text(middleText, middleX + 8, currentY + 8);
    }
  }

  // Draw value text with custom styling
  if (valueStyle.bgColor) {
    // Calculate text width for background
    const textWidth = doc.widthOfString(value) + 16;
    const rightEdge = 40 + tableWidth;

    if (valueAlign === "right") {
      // Draw background rectangle for highlighting
      doc
        .roundedRect(
          rightEdge - textWidth - 8,
          currentY + 4,
          textWidth,
          rowHeight - 8,
          3
        )
        .fill(valueStyle.bgColor);
    }
  }

  if (valueStyle.color) {
    doc.fillColor(valueStyle.color);
  } else {
    doc.fillColor("#000000");
  }

  if (valueStyle.bold) {
    doc.font("Helvetica-Bold");
  } else {
    doc.font("Helvetica");
  }

  if (valueStyle.fontSize) {
    doc.fontSize(valueStyle.fontSize);
  } else {
    doc.fontSize(12);
  }

  if (valueAlign === "right") {
    // Aplicar margen derecho al texto si está especificado
    const marginRight = valueStyle.marginRight || 0;

    doc.text(value, 40, currentY + 8, {
      width: tableWidth - 8 - marginRight, // Restar el margen aquí
      align: "right",
    });
  } else if (valueAlign === "center") {
    // Para centrar el texto
    doc.text(value, 40, currentY + 8, {
      width: tableWidth,
      align: "center",
    });
  } else {
    const valueX = middleText ? 40 + tableWidth * 0.7 : 40 + tableWidth * 0.4;
    doc.text(value, valueX + 8, currentY + 8);
  }

  // Update document Y position
  doc.y = currentY + rowHeight;
}

const agruparRecargos = (
  recargo,
  configuraciones_salario,
  opciones = {}
) => {
  const grupos = {};
  const { periodo_start, periodo_end } = opciones;

  const crearClave = (recargo) =>
    `${recargo.vehiculo.placa}-${recargo.mes}-${recargo.año}-${recargo.empresa.nit}`;

  const obtenerConfiguracion = (empresaId, sedeConductor) => {
    if (!configuraciones_salario) {
      console.warn("[DESPRENDIBLE][CONFIG] No hay configuraciones de salario disponibles");
      return null;
    }
    const sedeLower = (sedeConductor || '').toLowerCase();
    let matchReason = 'no_match';
    let cfg = configuraciones_salario.find(c => c.sede && c.sede.toLowerCase() === sedeLower && c.empresa_id === empresaId && c.activo);
    if (cfg) {
      matchReason = 'sede+empresa';
    } else {
      cfg = configuraciones_salario.find(c => c.sede && c.sede.toLowerCase() === sedeLower && !c.empresa_id && c.activo);
      if (cfg) {
        matchReason = 'solo_sede_global';
      } else {
        cfg = configuraciones_salario.find(c => c.empresa_id === empresaId && !c.sede && c.activo);
        if (cfg) {
          matchReason = 'solo_empresa';
        } else {
          cfg = configuraciones_salario.find(c => c.empresa_id === empresaId && c.sede && c.activo);
          if (cfg) {
            matchReason = 'empresa_con_cualquier_sede';
          } else {
            cfg = configuraciones_salario.find(c => c.empresa_id === null && !c.sede && c.activo);
            if (cfg) {
              matchReason = 'global_sin_sede';
            } else {
              cfg = configuraciones_salario.find(c => c.empresa_id === null && c.activo);
              if (cfg) {
                matchReason = 'global_con_sede';
              }
            }
          }
        }
      }
    }
    try {
      console.info(JSON.stringify({
        scope: 'SALARIO_MATCH',
        contexto: 'agruparRecargos',
        liquidacion_id: opciones.liquidacion_id || null,
        empresa_id: empresaId,
        conductor_sede: sedeConductor || null,
        match_reason: matchReason,
        configuracion: cfg ? {
          id: cfg.id,
          empresa_id: cfg.empresa_id,
          sede: cfg.sede || null,
          salario_basico: cfg.salario_basico || null,
          valor_hora_trabajador: cfg.valor_hora_trabajador || null,
          vigencia_desde: cfg.vigencia_desde || null,
          vigencia_hasta: cfg.vigencia_hasta || null
        } : null
      }));
    } catch (_e) { /* noop */ }
    return cfg || null;
  };

  const inicializarGrupo = (recargo) => {
    const configuracion = obtenerConfiguracion(recargo.empresa.id, opciones.conductor_sede);
    if (!configuracion) return;

    return {
      vehiculo: recargo.vehiculo,
      mes: recargo.mes,
      año: recargo.año,
      empresa: recargo.empresa,
      recargos: [],
      configuracion_salarial: configuracion,
      valor_hora_base: configuracion.salario_basico / configuracion.horas_mensuales_base || 0,
      totales: {
        total_dias: 0,
        total_horas: 0,
        total_hed: 0,
        total_rn: 0,
        total_hen: 0,
        total_rd: 0,
        total_hefd: 0,
        total_hefn: 0,
        valor_total: 0,
        total_dias_festivos: 0,
        total_dias_domingos: 0,
      },
      dias_laborales_unificados: [],
      tipos_recargos_consolidados: [],
      periodo_validacion: {
        periodo_start,
        periodo_end,
        dias_excluidos: 0,
        dias_procesados: 0
      }
    };
  };

  const construirFechaCompleta = (diaLaboral) => {
    // Si es solo un número, no se puede construir fecha
    if (typeof diaLaboral === 'number') {
      console.warn('diaLaboral es solo un número, no se puede construir fecha completa');
      return null;
    }

    // Si ya tiene fecha_completa
    if (diaLaboral?.fecha_completa) {
      return diaLaboral.fecha_completa;
    }

    // Construir fecha usando día, mes y año
    if (diaLaboral?.dia && diaLaboral?.mes && diaLaboral?.año) {
      const año = diaLaboral.año;
      const mes = diaLaboral.mes.toString().padStart(2, '0');
      const dia = diaLaboral.dia.toString().padStart(2, '0');
      const fechaConstructa = `${año}-${mes}-${dia}`;
      return fechaConstructa;
    }

    console.warn('No se pudo construir fecha completa. Datos insuficientes:', diaLaboral);
    return null;
  };

  const esDiaDelPeriodo = (diaLaboral, periodoInicio, periodoFin) => {
    if (!periodoInicio || !periodoFin) {
      console.warn('No se especificó período válido, procesando todos los días');
      return true;
    }

    const fechaCompleta = construirFechaCompleta(diaLaboral);
    if (!fechaCompleta) {
      console.warn('No se pudo construir fecha completa del día laboral:', diaLaboral);
      return false;
    }

    // Comparación de strings de fecha (YYYY-MM-DD) - más confiable
    const estaEnPeriodo = fechaCompleta >= periodoInicio && fechaCompleta <= periodoFin;
    return estaEnPeriodo;
  };

  const esDiaDelMesAño = (diaLaboral, mes, año) => {
    // Usar los valores directos del día laboral si están disponibles
    if (diaLaboral?.mes && diaLaboral?.año) {
      const coincide = diaLaboral.mes === mes && diaLaboral.año === año;
      return coincide;
    }

    // Fallback: construir fecha y validar
    const fechaCompleta = construirFechaCompleta(diaLaboral);
    if (!fechaCompleta) return false;

    const fecha = new Date(fechaCompleta);
    const mesDelDia = fecha.getMonth() + 1;
    const añoDelDia = fecha.getFullYear();
    const coincide = mesDelDia === mes && añoDelDia === año;
    return coincide;
  };

  // FUNCIÓN CORREGIDA: Ahora pasa el objeto completo del día
  const procesarDiaLaboral = (grupo, dia) => {
    // VALIDACIÓN 1: Verificar que el día esté en el período especificado
    // CORREGIDO: Pasar el objeto completo 'dia' en lugar de 'dia.dia'
    if (!esDiaDelPeriodo(dia, periodo_start, periodo_end)) {
      const fechaCompleta = construirFechaCompleta(dia);
      console.warn(`Día ${fechaCompleta || 'fecha inválida'} fuera del período ${periodo_start} - ${periodo_end}. Saltando...`);
      grupo.periodo_validacion.dias_excluidos++;
      return;
    }

    // VALIDACIÓN 2: Verificar que el día pertenezca al mes/año del grupo
    // CORREGIDO: Pasar el objeto completo 'dia' en lugar de 'dia.dia'
    if (!esDiaDelMesAño(dia, grupo.mes, grupo.año)) {
      const fechaCompleta = construirFechaCompleta(dia);
      console.warn(`Día ${fechaCompleta || 'fecha inválida'} no pertenece al período ${grupo.mes}/${grupo.año}. Saltando...`);
      grupo.periodo_validacion.dias_excluidos++;
      return;
    }

    // Si llegamos aquí, el día es válido
    grupo.periodo_validacion.dias_procesados++;

    // Contar días especiales
    if (dia.es_festivo) {
      grupo.totales.total_dias_festivos++;
    }
    if (dia.es_domingo) {
      grupo.totales.total_dias_domingos++;
    }

    // Buscar si ya existe un día con la misma fecha
    // CORREGIDO: Comparar por fecha completa o por dia/mes/año
    const diaExistente = grupo.dias_laborales_unificados.find((d) => {
      if (dia.fecha_completa && d.fecha_completa) {
        return d.fecha_completa === dia.fecha_completa;
      }
      if (dia.dia && dia.mes && dia.año && d.dia && d.mes && d.año) {
        return d.dia === dia.dia && d.mes === dia.mes && d.año === dia.año;
      }
      return d.dia === dia.dia; // Fallback
    });

    if (diaExistente) {
      const camposHoras = ["hed", "rn", "hen", "rd", "hefd", "hefn", "total_horas"];

      camposHoras.forEach((campo) => {
        const valorAnterior = diaExistente[campo] || 0;
        const valorNuevo = dia[campo] || 0;
        diaExistente[campo] = valorAnterior + valorNuevo;
      });
    } else {
      const nuevoDia = {
        ...dia,
        hed: dia.hed || 0,
        rn: dia.rn || 0,
        hen: dia.hen || 0,
        rd: dia.rd || 0,
        hefd: dia.hefd || 0,
        hefn: dia.hefn || 0,
      };

      grupo.dias_laborales_unificados.push(nuevoDia);
    }
  };

  const calcularValorRecargo = (valorBase, porcentaje, horas, esAdicional, esValorFijo = false, valorFijo = 0) => {
    if (esValorFijo && valorFijo > 0) {
      const valorFijoRedondeado = Number(valorFijo);
      const valorHoraConRecargo = valorFijoRedondeado / horas;
      return {
        valorTotal: valorFijoRedondeado,
        valorHoraConRecargo: Number(valorHoraConRecargo),
      };
    }

    let valorHoraConRecargo;
    let valorTotal;

    if (esAdicional) {
      valorHoraConRecargo = valorBase * (1 + porcentaje / 100);
      valorHoraConRecargo = Number(valorHoraConRecargo);
      valorTotal = valorHoraConRecargo * horas;
    } else {
      valorHoraConRecargo = valorBase * (porcentaje / 100);
      valorHoraConRecargo = Number(valorHoraConRecargo);
      valorTotal = valorHoraConRecargo * horas;
    }

    valorTotal = Number(valorTotal);
    return { valorTotal, valorHoraConRecargo };
  };

  const consolidarTipoRecargo = (grupo, tipo) => {
    const configSalarial = grupo.configuracion_salarial;
    const pagaDiasFestivos = configSalarial?.paga_dias_festivos || false;

    if (pagaDiasFestivos && tipo.codigo === "RD") {
      return;
    }

    const tipoExistente = grupo.tipos_recargos_consolidados.find(
      (t) => t.codigo === tipo.codigo,
    );

    const valorHoraBase = grupo.valor_hora_base;
    const porcentaje = tipo.porcentaje || 0;
    const horas = tipo.horas || 0;
    const esAdicional = tipo.adicional || false;

    const resultado = calcularValorRecargo(valorHoraBase, porcentaje, horas, esAdicional);

    if (tipoExistente) {
      tipoExistente.horas += horas;
      const nuevoResultado = calcularValorRecargo(valorHoraBase, porcentaje, tipoExistente.horas, esAdicional);
      tipoExistente.valor_calculado = nuevoResultado.valorTotal;
      tipoExistente.valor_hora_con_recargo = nuevoResultado.valorHoraConRecargo;
      tipoExistente.adicional = esAdicional;
    } else {
      const nuevoTipo = {
        ...tipo,
        codigo: tipo.codigo,
        nombre: tipo.nombre,
        porcentaje: porcentaje,
        horas: horas,
        valor_calculado: resultado.valorTotal,
        valor_hora_base: valorHoraBase,
        valor_hora_con_recargo: resultado.valorHoraConRecargo,
        adicional: esAdicional,
      };
      grupo.tipos_recargos_consolidados.push(nuevoTipo);
    }
  };

  const agregarBonoFestivo = (grupo) => {
    const configSalarial = grupo.configuracion_salarial;
    const totalDiasEspeciales = grupo.totales.total_dias_festivos + grupo.totales.total_dias_domingos;

    if (!configSalarial?.paga_dias_festivos || totalDiasEspeciales === 0) {
      return;
    }

    const salarioBasico = parseFloat(configSalarial.salario_basico.toString()) || 0;
    const porcentajeFestivos = parseFloat(configSalarial.porcentaje_festivos?.toString() || "0") || 0;
    const valorDiarioBase = salarioBasico / 30;
    const valorDiarioConRecargoTemp = valorDiarioBase * (porcentajeFestivos / 100);
    const valorDiarioConRecargo = Number(valorDiarioConRecargoTemp);
    const valorTotalDiasFestivos = totalDiasEspeciales * valorDiarioConRecargo;

    const bonoFestivo = {
      id: `bono_festivo_${grupo.empresa.nit}_${grupo.mes}_${grupo.año}`,
      codigo: "BONO_FESTIVO",
      nombre: "Bono Días Festivos/Dominicales",
      descripcion: "Bono por días festivos y dominicales trabajados",
      subcategoria: "bonos",
      porcentaje: porcentajeFestivos,
      adicional: false,
      es_valor_fijo: false,
      valor_fijo: null,
      aplica_festivos: true,
      aplica_domingos: true,
      aplica_nocturno: null,
      aplica_diurno: null,
      orden_calculo: 999,
      es_hora_extra: false,
      requiere_horas_extras: false,
      limite_horas_diarias: null,
      activo: true,
      vigencia_desde: new Date().toISOString(),
      vigencia_hasta: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      horas: totalDiasEspeciales,
      valor_hora_base: valorDiarioBase,
      valor_hora_con_recargo: valorDiarioConRecargo,
      valor_calculado: valorTotalDiasFestivos,
      es_bono_festivo: true,
    };

    grupo.tipos_recargos_consolidados.push(bonoFestivo);
  };

  const calcularTotalesFinales = (grupo) => {
    const configSalarial = grupo.configuracion_salarial;
    const pagaDiasFestivos = configSalarial?.paga_dias_festivos || false;

    const campos = ["hed", "rn", "hen", "hefd", "hefn"];
    campos.forEach((campo) => {
      const total = grupo.dias_laborales_unificados.reduce(
        (sum, dia) => sum + (dia[campo] || 0),
        0,
      );
      grupo.totales[`total_${campo}`] = total;
    });

    grupo.totales.total_rd = pagaDiasFestivos
      ? 0
      : grupo.dias_laborales_unificados.reduce((sum, dia) => sum + (dia.rd || 0), 0);

    agregarBonoFestivo(grupo);

    grupo.totales.valor_total = grupo.tipos_recargos_consolidados.reduce(
      (sum, tipo) => sum + tipo.valor_calculado,
      0,
    );

    // Ordenar por fecha completa si está disponible
    grupo.dias_laborales_unificados.sort((a, b) => {
      if (a.fecha_completa && b.fecha_completa) {
        return new Date(a.fecha_completa).getTime() - new Date(b.fecha_completa).getTime();
      }
      if (a.dia && b.dia && a.mes && b.mes && a.año && b.año) {
        const fechaA = new Date(a.año, a.mes - 1, a.dia);
        const fechaB = new Date(b.año, b.mes - 1, b.dia);
        return fechaA.getTime() - fechaB.getTime();
      }
      return (a.dia || 0) - (b.dia || 0); // Fallback
    });

    grupo.tipos_recargos_consolidados.sort((a, b) => {
      if (a.es_bono_festivo) return 1;
      if (b.es_bono_festivo) return -1;
      return a.porcentaje - b.porcentaje;
    });
  };

  // PROCESAMIENTO PRINCIPAL
  recargo.recargos.forEach((detalles) => {
    const clave = crearClave(detalles);

    if (!grupos[clave]) {
      grupos[clave] = inicializarGrupo(detalles);
    }

    grupos[clave].recargos.push(detalles);
    grupos[clave].totales.total_dias += detalles.total_dias || 0;
    grupos[clave].totales.total_horas += detalles.total_horas || 0;

    if (detalles.dias_laborales && detalles.dias_laborales.length > 0) {
      detalles.dias_laborales.forEach((dia) => {
        procesarDiaLaboral(grupos[clave], dia);

        // CORREGIDO: Pasar el objeto completo del día
        if (esDiaDelPeriodo(dia, periodo_start, periodo_end) &&
          esDiaDelMesAño(dia, grupos[clave].mes, grupos[clave].año)) {
          if (dia.tipos_recargos && dia.tipos_recargos.length > 0) {
            dia.tipos_recargos.forEach((tipo) => {
              consolidarTipoRecargo(grupos[clave], tipo);
            });
          }
        }
      });
    }
  });

  Object.values(grupos).forEach((grupo) => {
    calcularTotalesFinales(grupo);
  });

  const resultado = Object.values(grupos);

  return resultado;
};

// Función para calcular la altura que ocupará un grupo en el PDF
const calcularAlturaGrupoPDF = (doc, grupo) => {
  let altura = 0;

  if (!grupo) return 50;

  // 1. Espacio inicial
  altura += 30;

  // 2. Encabezado del vehículo 
  altura += 25;

  // 3. Información de empresa
  altura += 40;

  // 4. Encabezados de columnas
  altura += 25;

  // 5. Filas de días laborales
  const diasLaborales = grupo.dias_laborales_unificados || [];
  altura += diasLaborales.length * 20;

  // 6. Totales consolidados
  altura += 25 + 22; // encabezado + fila

  // 7. Sección de tipos de recargos
  if (grupo.tipos_recargos_consolidados && grupo.tipos_recargos_consolidados.length > 0) {
    altura += 25; // Encabezado
    altura += grupo.tipos_recargos_consolidados.length * 20; // Filas
    altura += 25; // SUBTOTAL
    altura += 60; // 3 conceptos adicionales
    altura += 25; // TOTAL FINAL
  }

  // 8. Espacio entre grupos
  altura += 20;

  return altura;
};

const formatToCOP = (amount) => {
  if (typeof amount === "string") {
    amount = parseFloat(amount);
  }
  return `$ ${amount.toLocaleString("es-CO")}`;
};

/**
 * Función para generar PDF de Prima
 * @param {Object} liquidacion - Objeto de liquidación
 * @returns {Promise<Buffer>} - Buffer del PDF generado
 */
async function generatePrimaPDF(liquidacion) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        margins: { top: 40, bottom: 30, left: 40, right: 40 },
      });

      const buffers = [];
      doc.on("data", buffers.push.bind(buffers));
      doc.on("end", () => resolve(Buffer.concat(buffers)));
      doc.on("error", reject);

      const primaryColor = liquidacion.es_cotransmeq ? '#FF9500' : '#2E8B57';
      const lightBg = liquidacion.es_cotransmeq ? '#FFF4E6' : '#FFF9E6';
      const borderColor = liquidacion.es_cotransmeq ? '#FFA726' : '#FFD700';

      // Header con logo
      const logoPath = liquidacion.es_cotransmeq 
        ? path.join(__dirname, "../../public/assets/cotransmeq.png")
        : path.join(__dirname, "../../public/assets/codi.png");
      
      try {
        // Mover 50% más arriba: 48 → 24 (48 * 0.50 = 24)
        doc.image(logoPath, doc.page.width - 154, 24, { width: 175 });
      } catch (err) {
        console.warn("⚠️ No se pudo cargar el logo");
      }

      // Título de la empresa
      doc.fontSize(13).fillColor(primaryColor).font("Helvetica-Bold")
        .text(
          liquidacion.es_cotransmeq
            ? "SERVICIOS Y TRANSPORTES COTRANSMEQ S.A.S"
            : "TRANSPORTES Y SERVICIOS ESMERALDA S.A.S",
          40, 45, { width: 300 }
        );

      doc.fontSize(10).fillColor("#000000").font("Helvetica")
        .text(`NIT: ${liquidacion.es_cotransmeq ? "901983227" : "901528440-3"}`, 40, 75);

      doc.fontSize(10).fillColor(primaryColor).font("Helvetica-Bold")
        .text("DESPRENDIBLE DE PRIMA - DICIEMBRE 2025", 40, 95);

      // Datos del empleado
      let currentY = 130;
      doc.rect(40, currentY, doc.page.width - 80, 60).stroke("#E0E0E0");

      const drawEmployeeRow = (label, value, y, isLast = false) => {
        doc.fontSize(12).fillColor("#000000").font("Helvetica")
          .text(label, 45, y + 5);
        doc.text(value, 45, y + 5, { align: "right", width: doc.page.width - 90 });
        if (!isLast) {
          doc.moveTo(40, y + 20).lineTo(doc.page.width - 40, y + 20).stroke("#E0E0E0");
        }
      };

      drawEmployeeRow(
        "Nombre",
        `${liquidacion.conductor?.nombre || 'N/A'} ${liquidacion.conductor?.apellido || 'N/A'}`,
        currentY
      );
      drawEmployeeRow(
        "C.C.",
        liquidacion.conductor?.numero_identificacion || 'N/A',
        currentY + 20
      );
      drawEmployeeRow(
        "Periodo",
        "Diciembre 2025",
        currentY + 40,
        true
      );

      // Sección de detalle
      currentY = 210;
      doc.fontSize(11).fillColor(primaryColor).font("Helvetica-Bold")
        .text("DETALLE DE PRIMA", 40, currentY);

      // Info destacada
      currentY += 25;
      doc.rect(40, currentY, doc.page.width - 80, 60)
        .fillAndStroke(lightBg, borderColor);

      doc.fontSize(10).fillColor("#000000").font("Helvetica-Bold")
        .text("Información importante:", 45, currentY + 5);
      
      doc.fontSize(9).font("Helvetica")
        .text(
          "Este desprendible corresponde al pago de la prima de servicios del segundo semestre del año 2025. Los valores que se detallan a continuación fueron cancelados en el mes de diciembre de 2025, dentro de los términos legales establecidos, y se presentan en este documento únicamente para su información y registro.",
          45, currentY + 20,
          { width: doc.page.width - 90, lineGap: 2 }
        );

      // Tabla de valores
      currentY += 75;
      const primaValue = parseFloat(liquidacion.prima || 0);
      const primaPendienteValue = parseFloat(liquidacion.prima_pendiente || 0);

      let rowY = currentY;
      if (primaValue > 0) {
        doc.rect(40, rowY, doc.page.width - 80, 35).stroke("#E0E0E0");
        
        doc.fontSize(12).fillColor("#000000").font("Helvetica")
          .text("Prima diciembre 2025", 45, rowY + 5);
        doc.fontSize(8).fillColor("#666666").font("Helvetica-Oblique")
          .text("Valor pagado en periodo anterior", 45, rowY + 20);

        doc.fontSize(12).fillColor("#2E8B57").font("Helvetica")
          .text(formatToCOP(primaValue), 45, rowY + 10, {
            align: "right",
            width: doc.page.width - 90
          });

        rowY += 35;
      }

      if (primaPendienteValue > 0) {
        doc.rect(40, rowY, doc.page.width - 80, 35).stroke("#E0E0E0");
        
        doc.fontSize(12).fillColor("#000000").font("Helvetica")
          .text("Ajuste prima diciembre 2025 (Parex)", 45, rowY + 5);
        doc.fontSize(8).fillColor("#666666").font("Helvetica-Oblique")
          .text("Valor pendiente adicional", 45, rowY + 20);

        doc.fontSize(12).fillColor("#007AFF").font("Helvetica")
          .text(formatToCOP(primaPendienteValue), 45, rowY + 10, {
            align: "right",
            width: doc.page.width - 90
          });
      }

      // Footer
      doc.fontSize(9).fillColor("#9E9E9E").font("Helvetica")
        .text(
          `Documento generado el ${new Date().toLocaleDateString('es-CO')}`,
          40,
          doc.page.height - 40,
          { align: "center", width: doc.page.width - 80 }
        );

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Función para generar PDF de Intereses de Cesantías
 * @param {Object} liquidacion - Objeto de liquidación
 * @returns {Promise<Buffer>} - Buffer del PDF generado
 */
async function generateInteresesCesantiasPDF(liquidacion) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        margins: { top: 40, bottom: 30, left: 40, right: 40 },
      });

      const buffers = [];
      doc.on("data", buffers.push.bind(buffers));
      doc.on("end", () => resolve(Buffer.concat(buffers)));
      doc.on("error", reject);

      const primaryColor = liquidacion.es_cotransmeq ? '#FF9500' : '#2E8B57';
      const lightBg = liquidacion.es_cotransmeq ? '#FFF4E6' : '#FFF9E6';
      const borderColor = liquidacion.es_cotransmeq ? '#FFA726' : '#FFD700';

      // Header con logo
      const logoPath = liquidacion.es_cotransmeq 
        ? path.join(__dirname, "../../public/assets/cotransmeq.png")
        : path.join(__dirname, "../../public/assets/codi.png");
      
      try {
        // Mover 50% más arriba: 48 → 24 (48 * 0.50 = 24)
        doc.image(logoPath, doc.page.width - 154, 24, { width: 175 });
      } catch (err) {
        console.warn("⚠️ No se pudo cargar el logo");
      }

      // Título de la empresa
      doc.fontSize(13).fillColor(primaryColor).font("Helvetica-Bold")
        .text(
          liquidacion.es_cotransmeq
            ? "SERVICIOS Y TRANSPORTES COTRANSMEQ S.A.S"
            : "TRANSPORTES Y SERVICIOS ESMERALDA S.A.S",
          40, 45, { width: 300 }
        );

      doc.fontSize(10).fillColor("#000000").font("Helvetica")
        .text(`NIT: ${liquidacion.es_cotransmeq ? "901983227" : "901528440-3"}`, 40, 75);

      doc.fontSize(10).fillColor(primaryColor).font("Helvetica-Bold")
        .text("DESPRENDIBLE DE INTERESES DE CESANTÍAS", 40, 95);

      // Datos del empleado
      let currentY = 130;
      doc.rect(40, currentY, doc.page.width - 80, 60).stroke("#E0E0E0");

      const drawEmployeeRow = (label, value, y, isLast = false) => {
        doc.fontSize(12).fillColor("#000000").font("Helvetica")
          .text(label, 45, y + 5);
        doc.text(value, 45, y + 5, { align: "right", width: doc.page.width - 90 });
        if (!isLast) {
          doc.moveTo(40, y + 20).lineTo(doc.page.width - 40, y + 20).stroke("#E0E0E0");
        }
      };

      drawEmployeeRow(
        "Nombre",
        `${liquidacion.conductor?.nombre || 'N/A'} ${liquidacion.conductor?.apellido || 'N/A'}`,
        currentY
      );
      drawEmployeeRow(
        "C.C.",
        liquidacion.conductor?.numero_identificacion || 'N/A',
        currentY + 20
      );
      drawEmployeeRow(
        "Periodo",
        "Año 2025",
        currentY + 40,
        true
      );

      // Sección de detalle
      currentY = 210;
      doc.fontSize(11).fillColor(primaryColor).font("Helvetica-Bold")
        .text("DETALLE DE INTERESES DE CESANTÍAS", 40, currentY);

      // Info destacada
      currentY += 25;
      doc.rect(40, currentY, doc.page.width - 80, 60)
        .fillAndStroke(lightBg, borderColor);

      doc.fontSize(10).fillColor("#000000").font("Helvetica-Bold")
        .text("Información importante:", 45, currentY + 5);
      
      doc.fontSize(9).font("Helvetica")
        .text(
          "Este desprendible corresponde al pago de los intereses de cesantías correspondientes al año 2025. Los valores que se detallan a continuación fueron cancelados dentro de los términos legales establecidos y se presentan en este documento para su información y registro.",
          45, currentY + 20,
          { width: doc.page.width - 90, lineGap: 2 }
        );

      // Tabla de valores
      currentY += 75;
      const interesesValue = parseFloat(liquidacion.interes_cesantias || 0);

      doc.rect(40, currentY, doc.page.width - 80, 35).stroke("#E0E0E0");
      
      doc.fontSize(12).fillColor("#000000").font("Helvetica")
        .text("Intereses de cesantías", 45, currentY + 5);
      doc.fontSize(8).fillColor("#666666").font("Helvetica-Oblique")
        .text("Calculado sobre el saldo de cesantías al 31 de diciembre", 45, currentY + 20);

      doc.fontSize(12).fillColor("#2E8B57").font("Helvetica")
        .text(formatToCOP(interesesValue), 45, currentY + 10, {
          align: "right",
          width: doc.page.width - 90
        });

      // Footer
      doc.fontSize(9).fillColor("#9E9E9E").font("Helvetica")
        .text(
          `Documento generado el ${new Date().toLocaleDateString('es-CO')}`,
          40,
          doc.page.height - 40,
          { align: "center", width: doc.page.width - 80 }
        );

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Controlador para generar PDFs comprimidos para descarga
 */
exports.downloadPDFs = async (req, res) => {
  const archiver = require('archiver');
  
  try {
    const { liquidacionIds } = req.body;

    if (
      !liquidacionIds ||
      !Array.isArray(liquidacionIds) ||
      liquidacionIds.length === 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Se requiere al menos un ID de liquidación",
      });
    }

    console.log(`📥 Generando ${liquidacionIds.length} desprendibles para descarga`);

    // Obtener liquidaciones con datos de conductor
    const liquidaciones = await Liquidacion.findAll({
      where: { id: liquidacionIds },
      include: [
        { model: Conductor, as: "conductor" },
        { model: Bonificacion, as: "bonificaciones" },
        { model: Pernote, as: "pernotes" },
        { model: Recargo, as: "recargos" },
        { model: Anticipo, as: "anticipos" },
      ],
    });

    if (liquidaciones.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No se encontraron liquidaciones",
      });
    }

    // Configurar headers para descarga
    const fechaDescarga = new Date().toISOString().split('T')[0];
    const nombreArchivo = `desprendibles_nomina_${fechaDescarga}.zip`;
    
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`);

    // Crear archivo ZIP
    const archive = archiver('zip', {
      zlib: { level: 9 } // Máxima compresión
    });

    // Manejar errores del archive
    archive.on('error', (err) => {
      console.error('❌ Error al crear archivo ZIP:', err);
      throw err;
    });

    // Pipe del archive a la respuesta
    archive.pipe(res);

    // Generar PDFs para cada liquidación (con el mismo procesamiento que en pdfQueue)
    for (const liquidacion of liquidaciones) {
      try {
        console.log(`📄 Generando PDFs para conductor: ${liquidacion.conductor?.nombre} ${liquidacion.conductor?.apellido}`);
        
        // Formatear nombre del conductor para la carpeta
        const nombreCompleto = `${liquidacion.conductor?.nombre || ''} ${liquidacion.conductor?.apellido || ''}`.trim();
        const nombreFormateado = nombreCompleto
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "") // Eliminar acentos
          .replace(/[^a-zA-Z0-9\s]/g, '') // Eliminar caracteres especiales
          .replace(/\s+/g, '_') // Reemplazar espacios por guiones bajos
          .toUpperCase();

        // Obtener fecha del periodo_end para el nombre del archivo
        const periodoEnd = new Date(liquidacion.periodo_end);
        const mesNombre = periodoEnd.toLocaleDateString('es-CO', { month: 'long' }).toUpperCase();
        
        // ✅ PASO 1: Obtener configuraciones de salario
        const configuracionesSalario = await obtenerConfiguracionesSalario(
          liquidacion.periodo_start,
          liquidacion.periodo_end
        );

        // ✅ PASO 2: Obtener recargos planilla del conductor
        let recargosDelPeriodo = [];
        if (liquidacion.conductor?.id) {
          recargosDelPeriodo = await obtenerRecargosPlanillaPorPeriodo(
            liquidacion.conductor.id,
            liquidacion.periodo_start,
            liquidacion.periodo_end
          );
        } else {
          console.warn(`⚠️ Liquidación ${liquidacion.id} no tiene conductor válido`);
        }

        // ✅ PASO 3: Procesar recargos con configuración salarial
        let recargosProcessados = [];
        if (recargosDelPeriodo.length > 0) {
          recargosProcessados = await procesarRecargosPorPeriodoConSalarios(
            recargosDelPeriodo,
            liquidacion.periodo_start,
            liquidacion.periodo_end,
            configuracionesSalario
          );
        }

        // ✅ PASO 4: Construir liquidación completa para PDF
        const liquidacionCompleta = {
          ...liquidacion.toJSON(),
          configuraciones_salario: configuracionesSalario,
          recargos_planilla: {
            periodo_start: liquidacion.periodo_start,
            periodo_end: liquidacion.periodo_end,
            total_recargos: recargosProcessados.length,
            total_dias_laborados: recargosProcessados.reduce((total, recargo) =>
              total + (recargo.dias_laborales?.length || 0), 0),
            total_horas_trabajadas: recargosProcessados.reduce((total, recargo) =>
              total + (parseFloat(recargo.total_horas) || 0), 0),
            recargos: recargosProcessados,
          },
        };

        // ✅ PASO 5: Generar PDF principal de nómina
        const pdfNominaBuffer = await generatePDF(liquidacionCompleta);
        archive.append(pdfNominaBuffer, { 
          name: `${nombreFormateado}/DESPRENDIBLE_NOMINA_${mesNombre}.pdf` 
        });
        console.log(`✅ PDF de nómina generado: ${nombreFormateado}/DESPRENDIBLE_NOMINA_${mesNombre}.pdf`);

        // ✅ PASO 6: Generar PDF de Prima (si tiene valor)
        const primaValue = parseFloat(liquidacion.prima || 0);
        const primaPendienteValue = parseFloat(liquidacion.prima_pendiente || 0);
        
        if (primaValue > 0 || primaPendienteValue > 0) {
          const pdfPrimaBuffer = await generatePrimaPDF(liquidacionCompleta);
          archive.append(pdfPrimaBuffer, { 
            name: `${nombreFormateado}/DESPRENDIBLE_PRIMA_DICIEMBRE_2025.pdf` 
          });
          console.log(`✅ PDF de prima generado: ${nombreFormateado}/DESPRENDIBLE_PRIMA_DICIEMBRE_2025.pdf`);
        }

        // ✅ PASO 7: Generar PDF de Intereses de Cesantías (si tiene valor)
        const interesesValue = parseFloat(liquidacion.interes_cesantias || 0);
        
        if (interesesValue > 0) {
          const pdfInteresesBuffer = await generateInteresesCesantiasPDF(liquidacionCompleta);
          archive.append(pdfInteresesBuffer, { 
            name: `${nombreFormateado}/DESPRENDIBLE_INTERESES_CESANTIAS_2025.pdf` 
          });
          console.log(`✅ PDF de intereses generado: ${nombreFormateado}/DESPRENDIBLE_INTERESES_CESANTIAS_2025.pdf`);
        }

      } catch (error) {
        console.error(`❌ Error generando PDFs para liquidación ${liquidacion.id}:`, error);
        // Continuar con las demás liquidaciones
      }
    }

    // Finalizar el archivo ZIP
    await archive.finalize();
    
    console.log(`✅ Archivo ZIP generado exitosamente con desprendibles de ${liquidaciones.length} conductores`);

  } catch (error) {
    console.error("❌ Error al generar PDFs para descarga:", error);
    
    // Si ya se enviaron headers, no podemos enviar JSON
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: "Error al generar los desprendibles",
        error: process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  }
};