// controllers/pdfController.js
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
    // password: process.env.REDIS_PASSWORD
  },
});

const emailQueue = new Queue("email-sending", {
  redis: {
    host: process.env.REDIS_HOST || "localhost",
    port: process.env.REDIS_PORT || 6379,
    // password: process.env.REDIS_PASSWORD
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
    const userId = req.usuario?.id;

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
    if (job.userId !== req.usuario?.id) {
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
        // Generar PDF para la liquidación
        const pdfBuffer = await generatePDF(liquidacion);

        console.log(pdfBuffer, "bufferssss");

        // Verificar que el buffer es válido
        if (!Buffer.isBuffer(pdfBuffer)) {
          console.error(
            `Error: El PDF generado para liquidación ${liquidacion.id} no es un Buffer válido`
          );
          throw new Error("El PDF generado no es válido");
        }

        // Verificar tamaño y contenido
        if (pdfBuffer.length <= 10) {
          console.error(
            `Error: El PDF generado para liquidación ${liquidacion.id} está vacío o demasiado pequeño`
          );
          throw new Error("El PDF generado está vacío o es muy pequeño");
        }

        console.log(
          `PDF generado correctamente para liquidación ${liquidacion.id}, tamaño: ${pdfBuffer.length} bytes`
        );

        pdfBuffers.push({
          data: pdfBuffer,
          filename: `Liquidacion_${liquidacion.conductor?.nombre || ""}_${
            liquidacion.conductor?.apellido || ""
          }_${liquidacion.id}.pdf`,
          conductorId: liquidacion.conductor?.id,
          email: liquidacion.conductor?.email,
        });
      } catch (pdfError) {
        console.error(
          `Error al generar PDF para liquidación ${liquidacion.id}:`,
          pdfError
        );
        // // Generar un PDF de respaldo simple
        // try {
        //   const fallbackBuffer = await generateFallbackPDF(`Liquidación ${liquidacion.id}`);
        //   pdfBuffers.push({
        //     data: fallbackBuffer,
        //     filename: `Liquidacion_${liquidacion.conductor?.nombre || ""}_${
        //       liquidacion.conductor?.apellido || ""
        //     }_${liquidacion.id}.pdf`,
        //     conductorId: liquidacion.conductor?.id,
        //     email: liquidacion.conductor?.email,
        //   });
        //   console.log(`PDF de respaldo generado para liquidación ${liquidacion.id}`);
        // } catch (fallbackError) {
        //   console.error(`Error al generar PDF de respaldo:`, fallbackError);
        //   // Continuar con la siguiente liquidación
        // }
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
  const { jobId, userId, pdfBuffers, emailConfig } = job.data;

  console.log(pdfBuffers, "pdfBuffers");

  try {
    // Obtener el estado del trabajo
    const jobState = activeJobs.get(jobId);
    if (!jobState) {
      throw new Error("Trabajo no encontrado");
    }

    // Actualizar progreso
    updateJobProgress(jobId, 65, userId); // 65%

    // Verificar estructura del pdfBuffers
    console.log(`Procesando ${pdfBuffers.length} buffers de PDF`);

    // Log para depuración
    console.log(
      `Adjuntos preparados para envío: ${JSON.stringify(
        pdfBuffers.map((a) => ({
          filename: a.filename,
          contentLength: a.data
            ? Buffer.isBuffer(a.data)
              ? a.data.length
              : "N/A"
            : "N/A",
          isBuffer: a.data ? Buffer.isBuffer(a.data) : false,
        }))
      )}`
    );

    // Agrupar PDFs por dirección de correo electrónico
    const emailAttachments = {};

    for (const pdf of pdfBuffers) {
      if (!pdf.email) {
        console.log(`PDF sin email: ${pdf.filename}`);
        continue;
      }

      if (!emailAttachments[pdf.email]) {
        emailAttachments[pdf.email] = [];
      }

      try {
        // Verificar que el contenido es un Buffer válido o convertirlo
        let pdfContent;

        if (Buffer.isBuffer(pdf.data)) {
          console.log(
            `PDF ${pdf.filename} ya es un Buffer válido de ${pdf.data.length} bytes`
          );
          pdfContent = pdf.data;
        } else if (typeof pdf.data === "string") {
          console.log(`Convirtiendo PDF ${pdf.filename} de string a Buffer`);
          pdfContent = Buffer.from(pdf.data, "base64");
        } else if (pdf.data && typeof pdf.data === "object") {
          console.log(
            `PDF ${pdf.filename} contiene un objeto, intentando procesar...`
          );

          // Manejar el caso de objeto Buffer serializado { type: 'Buffer', data: [...] }
          if (pdf.data.type === "Buffer" && Array.isArray(pdf.data.data)) {
            console.log(
              `Reconstruyendo Buffer a partir de objeto serializado para ${pdf.filename}`
            );
            pdfContent = Buffer.from(pdf.data.data);
          } else if (pdf.data.buffer && Buffer.isBuffer(pdf.data.buffer)) {
            pdfContent = pdf.data.buffer;
          } else {
            console.warn(
              `El PDF ${pdf.filename} no es un Buffer válido. Generando PDF de respaldo.`
            );
            pdfContent = await generateFallbackPDF(pdf.filename);
          }
        } else {
          console.warn(
            `El PDF ${pdf.filename} no tiene datos válidos. Generando PDF de respaldo.`
          );
          pdfContent = await generateFallbackPDF(pdf.filename);
        }

        // Verificar que el contenido es válido antes de agregarlo
        if (Buffer.isBuffer(pdfContent) && pdfContent.length > 0) {
          emailAttachments[pdf.email].push({
            filename: pdf.filename,
            content: pdfContent,
            contentType: "application/pdf",
          });
        } else {
          console.error(
            `No se pudo crear un Buffer válido para ${pdf.filename}`
          );
        }
      } catch (attachmentError) {
        console.error(
          `Error al procesar adjunto ${pdf.filename}:`,
          attachmentError
        );
        // Intentar generar un PDF de respaldo en caso de error
        try {
          const fallbackPdf = await generateFallbackPDF(pdf.filename);
          emailAttachments[pdf.email].push({
            filename: pdf.filename,
            content: fallbackPdf,
            contentType: "application/pdf",
          });
          console.log(`PDF de respaldo generado para ${pdf.filename}`);
        } catch (fallbackError) {
          console.error(
            `Error al generar PDF de respaldo para ${pdf.filename}:`,
            fallbackError
          );
        }
      }
    }

    // Enviar correos electrónicos
    const emails = Object.keys(emailAttachments);
    console.log(`Enviando correos a ${emails.length} destinatarios`);

    for (let i = 0; i < emails.length; i++) {
      const email = emails[i];
      const attachments = emailAttachments[email];

      console.log(
        `Preparando envío a ${email} con ${attachments.length} adjuntos`
      );

      // Verificar que hay adjuntos válidos
      if (attachments.length === 0) {
        console.warn(
          `No hay adjuntos válidos para enviar a ${email}, omitiendo`
        );
        continue;
      }

      // Log para depuración de los archivos adjuntos
      attachments.forEach((att, idx) => {
        console.log(
          `  Adjunto ${idx + 1}: ${
            att.filename
          }, tipo=${typeof att.content}, tamaño=${
            Buffer.isBuffer(att.content) ? att.content.length : "N/A"
          } bytes`
        );
      });

      // Actualizar progreso
      const progress = Math.round(65 + (i / emails.length) * 35); // 65% - 100%
      updateJobProgress(jobId, progress, userId);

      // Enviar correo
      try {
        await sendEmail({
          to: email,
          subject: emailConfig.subject,
          text: emailConfig.body,
          attachments,
        });
        console.log(`Correo enviado exitosamente a ${email}`);
      } catch (emailErr) {
        console.error(`Error al enviar correo a ${email}:`, emailErr);
        // Continuar con los otros correos a pesar del error
      }
    }

    // Actualizar estado a completado
    jobState.status = "completed";
    jobState.progress = 100;
    jobState.completedTime = new Date();

    // Notificar al usuario
    notifyUser(userId, "job:completed", {
      jobId,
      result: {
        totalEmails: emails.length,
        totalAttachments: pdfBuffers.length,
      },
    });

    console.log(
      `Trabajo ${jobId} completado: ${emails.length} correos enviados`
    );

    // Programar eliminación del trabajo después de un tiempo
    setTimeout(() => {
      activeJobs.delete(jobId);
    }, 30 * 60 * 1000); // 30 minutos

    return done(null, { success: true });
  } catch (error) {
    console.error(`Error en envío de emails para trabajo ${jobId}:`, error);

    // Actualizar estado del trabajo
    const jobState = activeJobs.get(jobId);
    if (jobState) {
      jobState.status = "failed";
      jobState.error =
        error.message || "Error desconocido durante el envío de correos";

      // Notificar al usuario
      notifyUser(userId, "job:failed", {
        jobId,
        error: jobState.error,
      });
    }

    return done(error);
  }
});

/**
 * Función para enviar un correo electrónico
 * @param {Object} options - Opciones del correo
 * @returns {Promise<void>}
 */
async function sendEmail(options) {
  try {
    // Configurar el transporte de correo
    const transporterConfig = {
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT),
      secure: process.env.SMTP_SECURE === "true",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
      },
    };

    const transporter = nodemailer.createTransport(transporterConfig);

    // Verificar que todos los adjuntos son Buffers válidos
    let validAttachments = [];

    if (options.attachments && Array.isArray(options.attachments)) {
      validAttachments = options.attachments.filter((attachment) => {
        if (
          attachment.content &&
          Buffer.isBuffer(attachment.content) &&
          attachment.content.length > 0
        ) {
          return true;
        }
        console.warn(`Omitiendo adjunto inválido: ${attachment.filename}`);
        return false;
      });
    }

    // Preparar opciones de correo
    const mailOptions = {
      from: process.env.SMTP_USER || transporterConfig.auth.user,
      to: options.to,
      subject: options.subject,
      text: options.text,
      attachments: validAttachments,
    };

    // Log para depuración
    console.log(
      `Enviando correo a ${options.to} con ${validAttachments.length} adjuntos`
    );

    // Enviar el correo
    const result = await transporter.sendMail(mailOptions);
    console.log(`Correo enviado a ${options.to}: ${result.messageId}`);
    return result;
  } catch (error) {
    console.error(`Error al enviar correo a ${options.to}:`, error);
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
    console.log(liquidacion);
    try {
      // Create a new PDFDocument
      const doc = new PDFDocument({
        margins: { top: 30, bottom: 15, left: 40, right: 40 },
        size: "A4",
      });

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
        return value !== undefined && value !== null ? typeof(value) === "string" ? value : parseInt(value) : defaultValue;
      };

      const formatToCOP = (amount) => {
        if (typeof amount === "string") {
          amount = parseFloat(amount);
        }
        return `$ ${amount.toLocaleString("es-CO")}`;
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

      const imageX = 415; // Ajusta estas coordenadas según necesites
      const imageY = 15; // Ajusta la altura donde empieza la tabla de empleado

      // HEADER
      doc
        .fontSize(13)
        .fillColor("#2E8B57")
        .font("Helvetica-Bold")
        .text("TRANSPORTES Y SERVICIOS ESMERALDA S.A.S ZOMAC", {
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

      // PERIOD
      doc
        .fontSize(13)
        .fillColor("#2E8B57")
        .font("Helvetica-Bold")
        .text(
          `${formatDate(liquidacion.periodo_start)} - ${formatDate(
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
      const col1Width = tableWidth * 0.3; // Reduce ligeramente
      const col2Width = tableWidth * 0.35; // Aumenta
      const col3Width = tableWidth * 0.175;
      const col4Width = tableWidth * 0.175; // Asegura que sea suficiente

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

      // Helper function for concept table rows
      function drawConceptRow(
        concept,
        observation,
        quantity,
        value,
        options = {}
      ) {
        const {
          isLastRow = false,
          rowHeight = observation.length > 30 ? 35 : 24,
          observationFontSize = 10,
        } = options;

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
        doc
          .fontSize(observationFontSize)
          .text(observation, 40 + col1Width + 8, currentY + 6, {
            width: col2Width - 16,
            align: "left",
            lineGap: 2,
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
      } else {
        // Default bonificaciones
        [
          "Bono de alimentación",
          "Bono día trabajado",
          "Bono día trabajado doble",
          "Bono festividades",
        ].forEach((conceptName, index) => {
          drawConceptRow(conceptName, "", "0", formatToCOP(0));
        });
      }

      // Recargos
      drawConceptRow(
        "Recargos",
        "",
        recargosActualizados?.length || "0",
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
          "",
          recargosParex.length,
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

      // PERIOD
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
    rowHeight = 26  ,
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
    console.log(marginRight);

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
