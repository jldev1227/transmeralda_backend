// src/controllers/emailController.js
const nodemailer = require("nodemailer");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { v4: uuidv4 } = require("uuid");

class EmailController {
  /**
   * Envía correos electrónicos masivos con archivos PDF adjuntos
   * @param {Request} req - Objeto de solicitud Express
   * @param {Response} res - Objeto de respuesta Express
   */
  async sendMassEmails(req, res) {
    const { emailData, pdfBlobs } = req.body;

    // Validar datos requeridos
    if (
      !emailData ||
      !emailData.subject ||
      !emailData.body ||
      !emailData.recipients ||
      !pdfBlobs ||
      !pdfBlobs.length
    ) {
      return res.status(400).json({
        success: false,
        message: "Datos incompletos para el envío de correos.",
      });
    }

    try {
      // Crear un directorio temporal para guardar los PDFs
      const tempDir = path.join(os.tmpdir(), uuidv4());
      fs.mkdirSync(tempDir, { recursive: true });

      // Guardar los blobs de PDF como archivos temporales
      const pdfFiles = [];
      for (let i = 0; i < pdfBlobs.length; i++) {
        const pdfData = pdfBlobs[i].data;
        const fileName = pdfBlobs[i].filename || `documento_${i + 1}.pdf`;
        const filePath = path.join(tempDir, fileName);

        // Convertir el blob (base64) a un archivo
        const buffer = Buffer.from(pdfData, "base64");
        fs.writeFileSync(filePath, buffer);

        pdfFiles.push({
          id: i,
          filename: fileName,
          path: filePath,
          // Extraer identificador del conductor del nombre del archivo
          // Asumiendo que el formato es: Liquidacion_Nombre_Apellido_NumeroIdentificacion.pdf
          conductorId: fileName.split("_").pop().replace(".pdf", ""),
        });
      }

      // Configurar el transporte de correo
      const transporterConfig = {
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT,
        secure: process.env.SMTP_SECURE === "true",
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASSWORD,
        },
      };

      const transporter = nodemailer.createTransport(transporterConfig);

      // Enviar correos electrónicos a todos los destinatarios
      const { recipients, subject, body, cc, bcc } = emailData;
      const results = [];
      const failedEmails = [];

      // Enviar correos en lotes para evitar sobrecargar el servidor SMTP
      const BATCH_SIZE = 10;
      for (let i = 0; i < recipients.length; i++) {
        const recipient = recipients[i];

        // Obtener el identificador del destinatario (si está disponible)
        // Esto dependerá de cómo estés enviando la información desde el frontend
        const conductorId = recipient.split("|")[1] || `conductor_${i}`;

        // Filtrar solo los PDFs para este conductor
        // Si no hay identificación específica, se envía solo el PDF correspondiente al índice
        const attachments = pdfFiles.filter((pdf, index) => {
          if (pdf.conductorId && pdf.conductorId === conductorId) {
            return true;
          }
          // Si no hay match por ID, usar el índice como fallback
          return index === i;
        });

        try {
          const mailOptions = {
            from: transporterConfig.auth.user,
            to: recipient.split("|")[0] || recipient,
            subject: subject,
            ...(emailData.isHtml ? { html: body } : { text: body }),
            attachments: attachments,
          };

          if (cc) mailOptions.cc = cc;
          if (bcc) mailOptions.bcc = bcc;

          // Enviar el correo
          await transporter.sendMail(mailOptions);

          results.push({
            email: recipient,
            status: "success",
          });
        } catch (error) {
          console.error(`Error al enviar email a ${recipient}:`, error);
          failedEmails.push({
            email: recipient,
            error: error.message,
          });
          results.push({
            email: recipient,
            status: "failed",
            error: error.message,
          });
        }
      }

      // Limpiar archivos temporales
      pdfFiles.forEach((file) => {
        try {
          fs.unlinkSync(file.path);
        } catch (error) {
          console.warn(
            `No se pudo eliminar el archivo temporal: ${file.path}`,
            error
          );
        }
      });

      // Intentar eliminar el directorio temporal
      try {
        fs.rmdirSync(tempDir);
      } catch (error) {
        console.warn(
          `No se pudo eliminar el directorio temporal: ${tempDir}`,
          error
        );
      }

      // Enviar respuesta
      return res.status(200).json({
        success: true,
        message: `Correos enviados: ${results.length - failedEmails.length}/${
          recipients.length
        }`,
        results,
        failedEmails: failedEmails.length > 0 ? failedEmails : null,
      });
    } catch (error) {
      console.error("Error al enviar correos masivos:", error);
      return res.status(500).json({
        success: false,
        message: `Error al enviar correos masivos: ${error.message}`,
        error: error.toString(),
      });
    }
  }
}

module.exports = new EmailController();
