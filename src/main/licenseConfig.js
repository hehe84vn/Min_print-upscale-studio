'use strict';

module.exports = Object.freeze({
  supabaseUrl: 'https://bagsfbiogciepjpchvwn.supabase.co',
  publishableKey: 'sb_publishable_mP5TnVcPd76CFlYjbUq5Bw_fThm0Q5F',
  functionName: 'license-gateway',
  publicKeyPem: `-----BEGIN PUBLIC KEY-----
MIIBojANBgkqhkiG9w0BAQEFAAOCAY8AMIIBigKCAYEAuf6qeX6FI4gJDyQwAxcs
A1GTmxREeYpg7JMw+iowzWY0L6tmVYQFhxY5by4CXVVAJ3mP5JKktZUEMc241iX5
/55Xadlb2IyWv7jPMHHPG+qcyKNkeszE/soyqUiV5mu/zajXMGawfKA7xsPAYB3X
S7fXRV3dNJo0vDo1L87MPIAkfi2ZAFXbJVJOnPPOYbyuyjsOjVM93u7UlKpqNyjO
8ACwykb8V+RoaexZ3kwLXeVHlrYBUBc2a/G53tgad84EP9sZCiBTywVXMtwOvgZI
M7C1LsWwKcG3a8abiILpUIF5FyoFdmHBzPQcTejM8jaK4zPmxPDTYbW3MfMXzZVK
qd+VZnkZRlBAFQK+KhjK7te7qQRSCIzqWFFdzFz6LUBxdOm469Nuff/EHZXvXkQ7
WT5l/0CmHPQKUyIbh77XVjuRovKszg3d4QEA/SgGl+kLbdUMd109nMwmkNbz5v6x
glBPpc2M5OKfTUPJQvXp2ndpiQduCuczBebLm4Zj1OJ9AgMBAAE=
-----END PUBLIC KEY-----`,
  requestTimeoutMs: 10_000,
  onlineValidationIntervalMs: 6 * 60 * 60 * 1000,
  clockToleranceMs: 5 * 60 * 1000
});
