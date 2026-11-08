param([string]$Out)
# 테스트용 견적서(.xls)를 진짜 엑셀로 만든다 — web/src/testing/fixtures/quote-excel.xls.
# 엑셀이 설치된 Windows 에서: powershell -NoProfile -ExecutionPolicy Bypass -File web/scripts/make-quote-xls.ps1 -Out <경로>
$ErrorActionPreference = 'Stop'
$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
try {
  $wb = $excel.Workbooks.Add()
  $ws = $wb.Worksheets.Item(1)
  $ws.Name = '견적서'
  $ws.Range('A1:E1').Merge()
  $ws.Range('A1').Value2 = '견 적 서'
  $ws.Range('A1').Font.Bold = $true
  $ws.Range('A1').Font.Size = 18
  $ws.Range('A1').HorizontalAlignment = -4108
  $ws.Range('A3').Value2 = '가나상사 귀하'
  $ws.Range('D3').Value2 = '견적일'
  $ws.Range('E3').Value2 = [double]46334            # 2026-11-08
  $ws.Range('E3').NumberFormat = 'yyyy-mm-dd'
  $ws.Range('A5').Value2 = '품목'; $ws.Range('B5').Value2 = '수량'; $ws.Range('C5').Value2 = '단가'; $ws.Range('D5').Value2 = '금액'; $ws.Range('E5').Value2 = '비고'
  $ws.Range('A5:E5').Interior.Color = 15773696
  $items = @(@('볼펜', 3, 1500), @('공책', 2, 2500), @('A4 용지', 5, 23000))
  for ($i = 0; $i -lt $items.Count; $i++) {
    $r = 6 + $i
    $ws.Range("A$r").Value2 = [string]$items[$i][0]
    $ws.Range("B$r").Value2 = [double]$items[$i][1]
    $ws.Range("C$r").Value2 = [double]$items[$i][2]
    $ws.Range("D$r").Formula = "=B$r*C$r"
  }
  $ws.Range('C6:D12').NumberFormat = '#,##0'
  $ws.Range('A9').Value2 = '합계';   $ws.Range('D9').Formula = '=SUM(D6:D8)'
  $ws.Range('A10').Value2 = '부가세'; $ws.Range('D10').Formula = '=ROUNDDOWN(D9*0.1,-1)'
  $ws.Range('A11').Value2 = '총액';   $ws.Range('D11').Formula = '=D9+D10'
  $ws.Range('A12').Value2 = '금액';   $ws.Range('B12').Formula = '="일금 "&NUMBERSTRING(D11,1)&"원정"'
  $ws.Range('A14').Value2 = '납기: 발주 후 7일'
  $ws.Range('A5:E11').Borders.LineStyle = 1
  $ws.Range('A1').EntireColumn.ColumnWidth = 14
  $ws.PageSetup.Orientation = 1
  $ws.PageSetup.CenterHorizontally = $true
  $wb.SaveAs($Out, 56)   # xlExcel8 (.xls 97-2003)
  $wb.Close($false)
  "saved $Out"
} finally {
  $excel.Quit()
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null
}
