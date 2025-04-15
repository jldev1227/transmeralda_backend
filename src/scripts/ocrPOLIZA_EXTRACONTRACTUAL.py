import json
import re
from datetime import datetime
import sys
import unicodedata
import traceback
import os
import argparse

# Diccionario para traducir meses en español a números
MESES = {
    "enero": "01", "febrero": "02", "marzo": "03", "abril": "04", "mayo": "05", "junio": "06",
    "julio": "07", "agosto": "08", "septiembre": "09", "octubre": "10", "noviembre": "11", "diciembre": "12"
}

# Función para normalizar texto
def normalize_text(text):
    return unicodedata.normalize('NFKD', text).encode('ASCII', 'ignore').decode('utf-8').upper()

class PolizaExtraContractualProcessor:
    def __init__(self, ocr_data, placa_param=None):
        self.data = ocr_data
        self.content = ocr_data.get('analyzeResult', {}).get('content', '')
        self.lines = self.content.split('\n')
        self.placa_param = placa_param.upper() if placa_param else None
        self.result = {
            "placa": None,
            "polizaExtraContractualVencimiento": None,
        }
        
        # Palabras clave para identificar contextos relevantes
        self.palabras_clave_vigencia = [
            "VIGENCIA", "VENCIMIENTO", "HASTA", "VÁLIDO HASTA", "VALIDO HASTA",
            "RESPONSABILIDAD CIVIL CONTRACTUAL", "SEGURO RC CONTRACTUAL", "RESPONSABILIDAD CIVIL EXTRACONTRACTUAL", "SEGURO EXTRACONTRACTUAL",
        ]
    
    def find_line_index(self, keyword, normalize=True):
        """Encontrar el índice de la línea que contiene una palabra clave"""
        keyword_norm = normalize_text(keyword) if normalize else keyword
        for i, line in enumerate(self.lines):
            line_norm = normalize_text(line) if normalize else line
            if keyword_norm in line_norm:
                return i
        return -1
    
    def extract_placa(self):
        """Extraer la placa del vehículo"""
        # Si tenemos una placa de parámetro, verificar si está en el documento
        if self.placa_param:
            placa_presente = False
            for line in self.lines:
                if self.placa_param in normalize_text(line):
                    placa_presente = True
                    self.result["placa"] = self.placa_param
                    break
            
            # Si la placa no está presente, buscar cualquier placa
            if not placa_presente:
                self.buscar_cualquier_placa()
            
            return placa_presente
        else:
            # Si no hay placa de parámetro, buscar cualquier placa
            return self.buscar_cualquier_placa()
    
    def buscar_cualquier_placa(self):
        """Buscar cualquier patrón de placa en el documento"""
        for line in self.lines:
            match = re.search(r'[A-Z]{3}\d{3}', line)
            if match:
                self.result["placa"] = match.group(0)
                return True
        return False
    
    def extract_fecha_vencimiento(self):
        """Extraer fecha de vencimiento de la póliza extracontractual"""
        # Recolectar todas las fechas encontradas
        fechas_encontradas = []
        
        # 1. Buscar fechas cerca de palabras clave de vigencia
        for keyword in self.palabras_clave_vigencia:
            venc_idx = self.find_line_index(keyword)
            if venc_idx >= 0:
                # Analizar esta línea y las siguientes
                for i in range(venc_idx, min(venc_idx + 5, len(self.lines))):
                    fechas_encontradas.extend(self.extract_dates_from_text(self.lines[i]))
        
        # 2. Si no encontramos fechas con contexto, buscar todas las fechas
        if not fechas_encontradas:
            for line in self.lines:
                fechas_encontradas.extend(self.extract_dates_from_text(line))
        
        # 3. Seleccionar la fecha más apropiada
        if fechas_encontradas:
            # Convertir strings a objetos datetime
            fechas_datetime = [datetime.strptime(fecha, "%Y-%m-%d") for fecha in fechas_encontradas]
            
            # Verificar fechas futuras
            fecha_actual = datetime.now()
            fechas_futuras = [fecha for fecha in fechas_datetime if fecha > fecha_actual]
            
            if fechas_futuras:
                # Seleccionar la fecha futura más lejana como vencimiento
                fecha_vencimiento = max(fechas_futuras)
            else:
                # Si no hay fechas futuras, tomar la más reciente
                fecha_vencimiento = max(fechas_datetime)
            
            self.result["polizaExtraContractualVencimiento"] = fecha_vencimiento.strftime("%Y-%m-%d")
            return True
            
        return False
    
    def extract_dates_from_text(self, text):
        """Extraer todas las fechas de un texto dado"""
        fechas = []
        
        # Formatos estándar de fecha
        date_patterns = [
            (r"\b(\d{2})/(\d{2})/(\d{4})\b", "%d/%m/%Y"),  # DD/MM/YYYY
            (r"\b(\d{2})-(\d{2})-(\d{4})\b", "%d-%m-%Y"),  # DD-MM-YYYY
            (r"\b(\d{4})-(\d{2})-(\d{2})\b", "%Y-%m-%d"),  # YYYY-MM-DD
            (r"\b(\d{4})/(\d{2})/(\d{2})\b", "%Y/%m/%d")   # YYYY/MM/DD
        ]
        
        # Buscar fechas con formatos estándar
        for pattern, fmt in date_patterns:
            for match in re.finditer(pattern, text):
                try:
                    if fmt == "%d/%m/%Y" or fmt == "%d-%m-%Y":
                        day, month, year = match.groups()
                        fecha = datetime(int(year), int(month), int(day))
                    else:  # YYYY-MM-DD or YYYY/MM/DD
                        year, month, day = match.groups()
                        fecha = datetime(int(year), int(month), int(day))
                    fechas.append(fecha.strftime("%Y-%m-%d"))
                except ValueError:
                    continue
        
        # Buscar fechas con meses en texto (e.g., "23 de septiembre de 2024")
        text_lower = text.lower()
        for mes, num in MESES.items():
            pattern = re.compile(rf"(\d{{1,2}}) de {mes} de (\d{{4}})")
            for match in pattern.finditer(text_lower):
                try:
                    dia, anio = match.groups()
                    fecha = datetime(int(anio), int(num), int(dia))
                    fechas.append(fecha.strftime("%Y-%m-%d"))
                except ValueError:
                    continue
        
        return fechas
    
    def process(self):
        """Procesar todos los campos y devolver el resultado"""
        self.extract_placa()
        self.extract_fecha_vencimiento()
        
        return self.result

# Función principal para procesar el OCR
def process_poliza_extra_contractual(data, placa_param=None):
    try:
        processor = PolizaExtraContractualProcessor(data, placa_param)
        result = processor.process()
        return result
    except Exception as e:
        return {"error": str(e), "trace": traceback.format_exc()}

# Ejecución principal
if __name__ == "__main__":
    try:
        parser = argparse.ArgumentParser(description='Procesar datos OCR')
        parser.add_argument('--file', type=str, help='Ruta al archivo JSON con datos OCR')
        parser.add_argument('--placa', type=str, help='Placa del vehículo (opcional)')
        
        args = parser.parse_args()
        
        # Determinar qué archivo procesar
        file_path = None
        
        if args.file:
            # Usar el archivo especificado por argumento
            file_path = args.file
            if not os.path.exists(file_path):
                print(f"ERROR: El archivo {file_path} no existe", file=sys.stderr)
                print(json.dumps({"error": f"Archivo no encontrado: {file_path}"}))
                sys.exit(1)
        elif len(sys.argv) > 1 and not sys.argv[1].startswith('--'):
            # Si el primer argumento no es una opción, intentar interpretarlo como JSON
            try:
                data = json.loads(sys.argv[1])
                # Si llegamos aquí, el JSON se parseó correctamente, no necesitamos archivo
                file_path = None
            except json.JSONDecodeError:
                print("ERROR: El primer argumento no es JSON válido", file=sys.stderr)
                print(json.dumps({"error": "Argumento no es JSON válido"}))
                sys.exit(1)
        else:
            # Usar archivo por defecto
            file_path = './src/temp/tempOcrData_POLIZA_EXTRACONTRACTUAL.json'
            if not os.path.exists(file_path):
                print(f"ERROR: El archivo por defecto {file_path} no existe", file=sys.stderr)
                print(json.dumps({"error": f"Archivo por defecto no encontrado: {file_path}"}))
                sys.exit(1)
        
        # Leer datos si es necesario
        if file_path:
            try:
                with open(file_path, 'r', encoding='utf-8') as file:
                    data = json.load(file)
            except json.JSONDecodeError as e:
                print(f"ERROR: El archivo no contiene JSON válido: {str(e)}", file=sys.stderr)
                print(json.dumps({"error": f"JSON inválido en archivo: {str(e)}"}))
                sys.exit(1)
        
        # Procesar los datos
        result = process_poliza_extra_contractual(data)
        
        # Imprimir resultado como JSON (único output a stdout)
        print(json.dumps(result, indent=4, ensure_ascii=False))
        
    except Exception as e:
        # Errores a stderr para depuración
        print(f"ERROR inesperado: {str(e)}", file=sys.stderr)
        print(f"Traceback: {traceback.format_exc()}", file=sys.stderr)
        
        # Error en formato JSON a stdout para que el proceso JS pueda capturarlo
        print(json.dumps({"error": str(e)}))
        sys.exit(1)