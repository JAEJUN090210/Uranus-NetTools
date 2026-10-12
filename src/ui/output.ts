import type { Runtime } from '../cli/runtime';
import { type Colors, createColors, shouldUseColor } from './colors';
import { getSymbols, supportsUnicode, type Symbols } from './symbols';
import { type Column, renderTable } from './table';

export interface OutputOptions {
  readonly json?: boolean;
  readonly quiet?: boolean;
  readonly verbose?: boolean;
}

/** 모든 명령이 쓰는 출력 창구입니다. --json, --quiet, --verbose에 따라 무엇을 어디로 보낼지 정합니다. */
export class Output {
  readonly json: boolean;
  readonly quiet: boolean;
  readonly verbose: boolean;
  readonly symbols: Symbols;
  readonly colors: Colors;
  private readonly errorColors: Colors;

  constructor(
    private readonly runtime: Runtime,
    options: OutputOptions = {},
  ) {
    this.json = options.json ?? false;
    this.quiet = options.quiet ?? false;
    this.verbose = options.verbose ?? false;
    this.symbols = getSymbols(supportsUnicode(runtime.env, runtime.platform));
    this.colors = createColors(!this.json && shouldUseColor(runtime.stdout, runtime.env));
    this.errorColors = createColors(shouldUseColor(runtime.stderr, runtime.env));
  }

  /** --json이면 data를 JSON으로 출력하고, 아니면 render로 사람이 읽는 형식을 출력합니다. */
  result(data: unknown, render: () => void): void {
    if (this.json) {
      this.runtime.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
      return;
    }
    render();
  }

  line(text = ''): void {
    if (!this.json) {
      this.runtime.stdout.write(`${text}\n`);
    }
  }

  success(text: string): void {
    this.line(`${this.colors.green(this.symbols.success)} ${text}`);
  }

  failure(text: string): void {
    this.line(`${this.colors.red(this.symbols.failure)} ${text}`);
  }

  summary(text: string): void {
    this.line(`${this.colors.cyan(this.symbols.info)} ${text}`);
  }

  table<Row>(rows: readonly Row[], columns: readonly Column<Row>[]): void {
    this.line(renderTable(rows, columns, this.colors));
  }

  /** 안내 문구입니다. --quiet이면 출력하지 않습니다. */
  hint(text: string): void {
    if (!this.quiet) {
      this.line(this.colors.dim(text));
    }
  }

  /** --verbose일 때만 내부 동작을 표준 에러로 출력합니다. */
  debug(text: string): void {
    if (this.verbose) {
      this.runtime.stderr.write(`${this.errorColors.dim(`debug: ${text}`)}\n`);
    }
  }

  warn(text: string): void {
    this.runtime.stderr.write(`${this.errorColors.yellow(`${this.symbols.warning} ${text}`)}\n`);
  }

  /** 에러는 표준 에러로 보냅니다. --json이면 스크립트가 읽을 수 있게 JSON으로 출력합니다. */
  error(message: string): void {
    if (this.json) {
      this.runtime.stderr.write(`${JSON.stringify({ error: message })}\n`);
      return;
    }
    this.runtime.stderr.write(`${this.errorColors.red(`${this.symbols.failure} ${message}`)}\n`);
  }
}
