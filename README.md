# CSV & Parquet Data Analyzer

Uma aplicação web robusta desenvolvida com **Python (Flask)** e **Pandas** para análise de grandes volumes de dados. O projeto converte arquivos CSV para o formato **Parquet**, garantindo consultas ultra-rápidas e análise estatística em tempo real.

![home](static/interface.png)

## Funcionalidades

- **Conversão Automática:** Transforma CSVs e XLSXs pesados em arquivos Parquet otimizados.
- **Upload ágil:** Realize upload de arquivos CSV, XLSX ou Parquet apenas arrastando o arquivo para a tela.
- **UI Responsiva:** Interface Dark Mode com painéis laterais retráteis e feedback visual de carregamento.
- **Query JQL (JSON Query Language):** Filtros avançados com suporte a operadores `=` (igual), `~` (contém),  `!~` (não contém), `AND` e `OR`.
- **Análise Quantitativa:** Contagem de valores e frequências com um clique no cabeçalho.
- **Visualização de Performance:** Contagem de tempo para a importação do arquivo e tempo da execução do filtro.
- **Persistência:** Histórico de arquivos carregados com opção de taguear com nomes e excluir.
- **Exportação:** Gere relatórios em Excel (.xlsx) baseados nos seus filtros atuais.

---

## Requisitos

Para rodar este projeto, você precisará das seguintes bibliotecas:

* **Flask**: Servidor web.
* **Pandas**: Manipulação de dados.
* **PyArrow**: Motor para processamento de arquivos Parquet.
* **OpenPyXL**: Suporte para exportação de arquivos Excel.

---

## Como Executar

1. **Instale as dependências:**
   `pip install -r requirements.txt`

2. **Inicie o servidor:**
   `python app.py`

3. **Acesse no navegador:**
   [http://127.0.0.1:5001](http://127.0.0.1:5001)

4. **Realize um teste com um arquivo de exemplo**
   [https://www.datablist.com/learn/csv/download-sample-csv-files](https://www.datablist.com/learn/csv/download-sample-csv-files)

---

## Sintaxe de Busca (JQL)

| Operador | Descrição | Exemplo |
| :--- | :--- | :--- |
| `=` | Correspondência exata | `Status = "Concluído"` |
| `~` | Contém o termo | `Nome ~ "Gabriel"` |
| `!~` | Não contém o termo | `Nome !~ "John"` |
| `AND` | Soma condições | `Setor = "TI" AND Salario ~ "5000"` |
| `OR` | Várias condições | `Idate = "26" OR Idade = "25"` |
| `( )` | Agrupamento | `Setor = "TI" AND (Idate = "26" OR Idade = "25")` |

---

## Estrutura do Projeto

* `app.py`: Backend Flask.
* `uploads/`: Pasta gerada para armazenar os Parquets.
* `templates/index.html`: Interface Frontend.
