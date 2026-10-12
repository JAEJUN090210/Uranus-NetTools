import { InvalidArgumentError } from 'commander';

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
