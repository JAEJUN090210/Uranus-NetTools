import { InvalidArgumentError } from 'commander';

import { parsePortList } from '../core/scan/ports';

export function parsePositiveInteger(value: string): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new InvalidArgumentError('must be a positive integer.');
  }
  return number;
}

export function parsePositiveNumber(value: string): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new InvalidArgumentError('must be a positive number.');
  }
  return number;
}

export function parsePort(value: string): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 65535) {
    throw new InvalidArgumentError('must be a port number between 1 and 65535.');
  }
  return number;
}

/** 22,80,443 이나 1-1024 같은 포트 목록입니다. */
export function parsePorts(value: string): number[] {
  try {
    return parsePortList(value);
  } catch (error) {
    throw new InvalidArgumentError(error instanceof Error ? error.message : String(error));
  }
}
