# Memory Pattern Detector

A web-based tool for analyzing memory scanner exports to detect bit-field patterns and boolean transitions.

## Features

- **Quick Scan**: Analyzes changed addresses for bit flips and boolean patterns
- **Mass Change**: Clusters addresses by proximity and matches expected event counts
- **Color-coded results**: Green for bits set (0→1), red for bits cleared (1→0), orange for bit swaps
- **Direction filtering**: Filter results by set/clear/mixed changes
- **Non-standard booleans**: Optional mode for broader boolean detection

## Usage

1. Open `index.html` in a web browser
2. Export CSV from your memory scanner with columns: `Address, Value, InitialValue`
3. Upload the CSV and click Analyze
4. Browse pattern categories and export filtered results

## CSV Format Requirements

- **Address**: Memory address (hex format preferred)
- **Value**: Current value (hex format)
- **InitialValue**: Previous/initial value (hex format)

## Pattern Types

- **Single Bit Flip**: Exactly one bit changed
- **Nibble Boolean**: 0x0 ↔ 0xF transitions
- **Byte Boolean**: 0x00 ↔ 0xFF transitions  
- **Word Boolean**: 0x0000 ↔ 0xFFFF transitions
- **DWord Boolean**: 0x00000000 ↔ 0xFFFFFFFF transitions

## Development

Built with vanilla JavaScript, HTML5, and CSS. No external dependencies required.

## License

See [LICENSE](LICENSE) file for details.
