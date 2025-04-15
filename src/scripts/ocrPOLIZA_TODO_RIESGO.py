import json
import re
from datetime import datetime
import unicodedata
import sys
import traceback
import os
import argparse

# Diccionario para meses en español (abreviados y completos)
MESES = {
    "ene": "01", "feb": "02", "mar": "03", "abr": "04", "may": "05", "jun": "06",
    "jul": "07", "ago": "08", "sep": "09", "oct": "10", "nov": "11", "dic": "12",
    "enero": "01", "febrero": "02", "marzo": "03", "abril": "04", "mayo": "05", "junio": "06",
    "julio": "07", "agosto": "08", "septiembre": "09", "octubre": "10", "noviembre": "11", "diciembre": "12"
}

# Función para normalizar texto
def normalize_text(text):
    return unicodedata.normalize('NFKD', text).encode('ASCII', 'ignore').decode('utf-8').upper()

class PolizaTodoRiesgoProcessor:
    def __init__(self, ocr_data, placa_param=None):
        self.data = ocr_data
        self.content = ocr_data.get('analyzeResult', {}).get('content', '')
        self.lines = self.content.split('\n')
        self.placa_param = placa_param.upper() if placa_param else None
        self.result = {
            "placa": False,
            "polizaTodoRiesgoVencimiento": None,
        }
        
        # Palabras clave para identificar contextos relevantes
        self.palabras_clave_poliza = [
            "POLIZA", "PÓLIZA", "TODO RIESGO", "SEGURO", "ASEGURADORA", 
            "COBERTURA", "VEHICULO", "VEHÍCULO", "AMPARO"
        ]
        
        self.palabras_clave_vigencia = [
            "VIGENCIA", "HASTA", "VENCIMIENTO", "FINALIZA", "EXPIRA", 
            "TERMINA", "VALIDEZ", "VALIDO HASTA", "VÁLIDO HASTA"
        ]
    
    def find_line_index(self, keyword, normalize=True):
        """Encontrar el índice de la línea que contiene una palabra clave"""
        keyword_norm = normalize_text(keyword) if normalize else keyword
        for i, line in enumerate(self.lines):
            line_norm = normalize_text(line) if normalize else line
            if keyword_norm in line_norm:
                return i
        return -1
    
    def is_valid_poliza(self):
        """Verificar si el documento es una póliza todo riesgo válida"""
        for keyword in self.palabras_clave_poliza:
            if self.find_line_index(keyword) >= 0:
                return True
        return False
    
    def extract_placa(self):
        """Extraer la placa del vehículo"""
        if not self.placa_param:
            return self.buscar_cualquier_placa()
            
        # Verificar si la placa proporcionada está en el documento
        for line in self.lines:
            if self.placa_param in normalize_text(line):
                self.result["placa"] = self.placa_param
                return
                
        # Si no encuentra la placa específica, buscar cualquier placa
        return self.buscar_cualquier_placa()
    
    def buscar_cualquier_placa(self):
        """Buscar cualquier patrón de placa en el documento"""
        placa_idx = self.find_line_index("PLACA")
        if placa_idx >= 0:
            # Buscar en esta línea y las siguientes
            for i in range(placa_idx, min(placa_idx + 5, len(self.lines))):
                match = re.search(r'[A-Z]{3}\d{3}', self.lines[i])
                if match:
                    self.result["placa"] = match.group(0)
                    return True
        
        # Si no encuentra con "PLACA", buscar patrón de placa en todas las líneas
        for line in self.lines:
            match = re.search(r'[A-Z]{3}\d{3}', line)
            if match:
                self.result["placa"] = match.group(0)
                return True
        
        return False

    def extract_segmented_dates(self):
        """Extraer fechas que aparecen segmentadas en el documento"""
        # Buscar "HASTA" como punto de referencia
        hasta_idx = self.find_line_index("HASTA")
        if hasta_idx >= 0:
            # Variables para almacenar los componentes de la fecha
            day = None
            month = None
            year = None
            
            # Examinar las líneas cercanas a "HASTA" (antes y después)
            for i in range(max(0, hasta_idx - 5), min(hasta_idx + 10, len(self.lines))):
                line = self.lines[i].strip()
                
                # Buscar patrones como "DD 11", "MM 04", "AAAA 2025"
                dd_match = re.search(r'DD\s+(\d{1,2})', line)
                if dd_match and not day:
                    day = dd_match.group(1)
                    
                mm_match = re.search(r'MM\s+(\d{1,2})', line)
                if mm_match and not month:
                    month = mm_match.group(1)
                    
                aaaa_match = re.search(r'AAAA\s+(20\d{2})', line)
                if aaaa_match and not year:
                    year = aaaa_match.group(1)
                
                # También buscar el patrón inverso "04 MM", "2025 AAAA"
                if not month and re.search(r'MM$', line):
                    # Buscar en la línea anterior
                    if i > 0:
                        prev_line = self.lines[i-1].strip()
                        num_match = re.search(r'^(\d{1,2})$', prev_line)
                        if num_match:
                            month = num_match.group(1)
                
                if not year and re.search(r'AAAA$', line):
                    # Buscar en la línea anterior
                    if i > 0:
                        prev_line = self.lines[i-1].strip()
                        year_match = re.search(r'^(20\d{2})$', prev_line)
                        if year_match:
                            year = year_match.group(1)
            
            # Si tenemos todos los componentes, formar la fecha
            if day and month and year:
                try:
                    fecha = datetime(int(year), int(month), int(day))
                    return fecha.strftime("%Y-%m-%d")
                except ValueError:
                    pass
        
        return None

    def extract_fecha_vencimiento(self):
        """Extraer fecha de vencimiento de la póliza todo riesgo"""
        # 1. Intentar extraer fechas segmentadas primero
        segmented_date = self.extract_segmented_dates()
        
        if segmented_date:
            self.result["polizaTodoRiesgoVencimiento"] = segmented_date
            return True
        
        fechas_encontradas = []
        
        # 2. Buscar fechas cercanas a palabras clave de vigencia
        for keyword in self.palabras_clave_vigencia:
            venc_idx = self.find_line_index(keyword)
            if venc_idx >= 0:
                # Buscar en esta línea y las 5 siguientes
                for i in range(venc_idx, min(venc_idx + 6, len(self.lines))):
                    fechas_encontradas.extend(self.extract_dates_from_text(self.lines[i]))
        
        # 3. Si no se encontraron fechas con contexto, buscar todas las fechas
        if not fechas_encontradas:
            for line in self.lines:
                fechas_encontradas.extend(self.extract_dates_from_text(line))
        
        # 4. Seleccionar la fecha más apropiada
        if fechas_encontradas:
            # Convertir strings a objetos datetime
            fechas_datetime = []
            for fecha_str in fechas_encontradas:
                try:
                    fechas_datetime.append(datetime.strptime(fecha_str, "%Y-%m-%d"))
                except ValueError:
                    continue
            
            if fechas_datetime:
                # Verificar fechas futuras
                fecha_actual = datetime.now()
                fechas_futuras = [fecha for fecha in fechas_datetime if fecha > fecha_actual]
                
                if fechas_futuras:
                    # Seleccionar la fecha futura más lejana como vencimiento
                    fecha_vencimiento = max(fechas_futuras)
                else:
                    # Si no hay fechas futuras, tomar la más reciente
                    fecha_vencimiento = max(fechas_datetime)
                
                self.result["polizaTodoRiesgoVencimiento"] = fecha_vencimiento.strftime("%Y-%m-%d")
                return True
        
        # Si no se encontró ninguna fecha
        self.result["polizaTodoRiesgoVencimiento"] = "No encontrado"
        return False    

    def extract_dates_from_text(self, text):
        """Extraer todas las fechas de un texto dado"""
        fechas = []
        
        # 1. Buscar fechas en formato DD-MMM-YYYY o DD-MMM.-YYYY (ej: 01-ENE-2023 o 01-ENE.-2023)
        matches = re.finditer(r"(\d{1,2})-(\w{3,})\.?-(\d{4})", text, re.IGNORECASE)
        for match in matches:
            try:
                day, month_text, year = match.groups()
                month_text = month_text.lower().replace('.', '')
                month = MESES.get(month_text)
                if month:
                    fecha_str = f"{year}-{month}-{int(day):02d}"
                    fechas.append(fecha_str)
            except (ValueError, KeyError):
                continue
        
        # 2. Buscar fechas en formato DD/MM/YYYY o DD-MM-YYYY
        for pattern, format_str in [
            (r"\b(\d{1,2})/(\d{1,2})/(\d{4})\b", "%d/%m/%Y"),
            (r"\b(\d{1,2})-(\d{1,2})-(\d{4})\b", "%d-%m-%Y")
        ]:
            matches = re.finditer(pattern, text)
            for match in matches:
                try:
                    date_str = match.group(0)
                    date_obj = datetime.strptime(date_str, format_str)
                    fechas.append(date_obj.strftime("%Y-%m-%d"))
                except ValueError:
                    continue
        
        # 3. Buscar fechas en formato YYYY-MM-DD o YYYY/MM/DD
        for pattern, format_str in [
            (r"\b(\d{4})-(\d{1,2})-(\d{1,2})\b", "%Y-%m-%d"),
            (r"\b(\d{4})/(\d{1,2})/(\d{1,2})\b", "%Y/%m/%d")
        ]:
            matches = re.finditer(pattern, text)
            for match in matches:
                try:
                    date_str = match.group(0)
                    date_obj = datetime.strptime(date_str, format_str)
                    fechas.append(date_obj.strftime("%Y-%m-%d"))
                except ValueError:
                    continue
        
        # 4. Buscar fechas en formato de texto (ej: "23 de septiembre de 2023")
        text_lower = text.lower()
        matches = re.finditer(r"(\d{1,2}) de (\w+) de (\d{4})", text_lower)
        for match in matches:
            try:
                day, month_text, year = match.groups()
                month = MESES.get(month_text)
                if month:
                    fecha_str = f"{year}-{month}-{int(day):02d}"
                    fechas.append(fecha_str)
            except (ValueError, KeyError):
                continue
        
        return fechas
    
    def process(self):
        """Procesar todos los campos y devolver el resultado"""
        if not self.is_valid_poliza():
            return {"error": "No es una póliza todo riesgo válida"}
        
        self.extract_placa()
        self.extract_fecha_vencimiento()
        
        return self.result

# Función principal para procesar el OCR
def process_poliza_todo_riesgo(data, placa_param=None):
    try:
        processor = PolizaTodoRiesgoProcessor(data, placa_param)
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
            file_path = './src/temp/tempOcrDataPOLIZA_TODO_RIESGO.json'
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
        result = process_poliza_todo_riesgo(data)
        
        # Imprimir resultado como JSON (único output a stdout)
        print(json.dumps(result, indent=4, ensure_ascii=False))
        
    except Exception as e:
        # Errores a stderr para depuración
        print(f"ERROR inesperado: {str(e)}", file=sys.stderr)
        print(f"Traceback: {traceback.format_exc()}", file=sys.stderr)
        
        # Error en formato JSON a stdout para que el proceso JS pueda capturarlo
        print(json.dumps({"error": str(e)}))
        sys.exit(1)