import subprocess
import tempfile
import os
import shutil

class CodeExecutor:
    def __init__(self):
        self.timeout = 10
        
        self.language_configs = {
            'python': {
                'extension': '.py',
                'compile_cmd': None,
                'run_cmd': ['python3', '{file}']
            },
            'javascript': {
                'extension': '.js',
                'compile_cmd': None,
                'run_cmd': ['node', '{file}']
            },
            'java': {
                'extension': '.java',
                'compile_cmd': ['javac', '{file}'],
                'run_cmd': ['java', '-cp', '{dir}', 'Main']
            },
            'cpp': {
                'extension': '.cpp',
                'compile_cmd': ['g++', '{file}', '-o', '{output}'],
                'run_cmd': ['{output}']
            },
            'c': {
                'extension': '.c',
                'compile_cmd': ['gcc', '{file}', '-o', '{output}'],
                'run_cmd': ['{output}']
            }
        }
    
    def execute(self, code, language):
        if language not in self.language_configs:
            return f"Error: Unsupported language '{language}'"
        
        if not code or not code.strip():
            return "Error: No code provided"
        
        config = self.language_configs[language]
        temp_dir = tempfile.mkdtemp()
        
        try:
            if language == 'java':
                filename = 'Main' + config['extension']
            else:
                filename = 'program' + config['extension']
            
            filepath = os.path.join(temp_dir, filename)
            
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(code)
            
            output_lines = []
            
            if config['compile_cmd']:
                compile_cmd = [
                    cmd.format(
                        file=filepath,
                        dir=temp_dir,
                        output=os.path.join(temp_dir, 'program')
                    ) for cmd in config['compile_cmd']
                ]
                
                output_lines.append(f"Compiling {language}...")
                
                try:
                    compile_result = subprocess.run(
                        compile_cmd,
                        capture_output=True,
                        text=True,
                        timeout=self.timeout,
                        cwd=temp_dir
                    )
                    
                    if compile_result.returncode != 0:
                        return "\n".join(output_lines) + f"\n\nCompilation Error:\n{compile_result.stderr}"
                    
                    output_lines.append("✓ Compilation successful\n")
                
                except subprocess.TimeoutExpired:
                    return "\n".join(output_lines) + "\n\nError: Compilation timeout"
                except Exception as e:
                    return "\n".join(output_lines) + f"\n\nCompilation Error: {str(e)}"
            
            run_cmd = [
                cmd.format(
                    file=filepath,
                    dir=temp_dir,
                    output=os.path.join(temp_dir, 'program')
                ) for cmd in config['run_cmd']
            ]
            
            output_lines.append("Executing code...\n")
            
            try:
                run_result = subprocess.run(
                    run_cmd,
                    capture_output=True,
                    text=True,
                    timeout=self.timeout,
                    cwd=temp_dir
                )
                
                if run_result.returncode != 0:
                    if run_result.stderr:
                        output_lines.append(f"Runtime Error:\n{run_result.stderr}")
                    else:
                        output_lines.append(f"Program exited with code {run_result.returncode}")
                else:
                    if run_result.stdout:
                        output_lines.append(run_result.stdout)
                    else:
                        output_lines.append("(No output)")
                    output_lines.append("\n✓ Execution completed successfully")
                
                return "\n".join(output_lines)
            
            except subprocess.TimeoutExpired:
                return "\n".join(output_lines) + f"\n\nError: Execution timeout ({self.timeout} seconds)"
            except Exception as e:
                return "\n".join(output_lines) + f"\n\nRuntime Error: {str(e)}"
        
        finally:
            try:
                shutil.rmtree(temp_dir, ignore_errors=True)
            except Exception:
                pass