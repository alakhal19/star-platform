const k8s = require('@kubernetes/client-node');

// ─── TLS FIX ──────────────────────────────────────────────────────────────────
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
// ─────────────────────────────────────────────────────────────────────────────

// ─── ERROR UNWRAPPER ──────────────────────────────────────────────────────────
const unwrapK8sError = (err) => {
  if (err?.body?.message) {
    const wrapped = new Error(err.body.message);
    wrapped.statusCode = err.body.code || err.statusCode;
    wrapped.reason = err.body.reason;
    return wrapped;
  }
  return err;
};
// ─────────────────────────────────────────────────────────────────────────────

const loadKubeConfig = () => {
  const kc = new k8s.KubeConfig();
  if (process.env.KUBECONFIG) {
    kc.loadFromFile(process.env.KUBECONFIG);
  } else {
    kc.loadFromDefault();
  }
  return kc;
};

const kubeConfig    = loadKubeConfig();
const coreApi       = kubeConfig.makeApiClient(k8s.CoreV1Api);
const appsApi       = kubeConfig.makeApiClient(k8s.AppsV1Api);
const networkingApi = kubeConfig.makeApiClient(k8s.NetworkingV1Api);

const ensureNamespace = async (name) => {
  try {
    await coreApi.readNamespace(name);
  } catch (err) {
    if (err.statusCode === 404 || err.response?.statusCode === 404) {
      await coreApi.createNamespace({ metadata: { name } });
      return;
    }
    throw unwrapK8sError(err);
  }
};

const upsertImagePullSecret = async ({ namespace, name, server, username, password, email = 'none' }) => {
  const dockerConfigJson = {
    auths: {
      [server]: {
        username,
        password,
        email,
        auth: Buffer.from(`${username}:${password}`).toString('base64'),
      },
    },
  };

  const secret = {
    apiVersion: 'v1',
    kind: 'Secret',
    metadata: { name, namespace },
    type: 'kubernetes.io/dockerconfigjson',
    data: {
      '.dockerconfigjson': Buffer.from(JSON.stringify(dockerConfigJson)).toString('base64'),
    },
  };

  try {
    await coreApi.readNamespacedSecret(name, namespace);
    return await coreApi.replaceNamespacedSecret(name, namespace, secret);
  } catch (err) {
    if (err.statusCode === 404 || err.response?.statusCode === 404) {
      return await coreApi.createNamespacedSecret(namespace, secret);
    }
    throw unwrapK8sError(err);
  }
};

const upsertDeployment = async ({
  namespace,
  name,
  image,
  containerPort,
  selectorLabels,   // used for spec.selector.matchLabels — immutable, no version
  podLabels,        // used for pod template metadata — can include version label
  env = [],
  replicas = 1,
  imagePullSecrets = [],
}) => {
  if (!image) {
    throw new Error(`upsertDeployment: "image" is required for deployment "${name}" but received: ${JSON.stringify(image)}`);
  }

  const deployment = {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: { name, namespace, labels: podLabels },
    spec: {
      replicas,
      selector: { matchLabels: selectorLabels },   // ← immutable, stable labels only
      template: {
        metadata: { labels: podLabels },            // ← can include release version
        spec: {
          imagePullSecrets,
          containers: [
            {
              name,
              image,
              ports: [{ containerPort }],
              env,
              imagePullPolicy: 'Always',
            },
          ],
        },
      },
    },
  };

  try {
    await appsApi.readNamespacedDeployment(name, namespace);
    return await appsApi.replaceNamespacedDeployment(name, namespace, deployment);
  } catch (err) {
    if (err.statusCode === 404 || err.response?.statusCode === 404) {
      return await appsApi.createNamespacedDeployment(namespace, deployment);
    }
    throw unwrapK8sError(err);
  }
};

const upsertService = async ({ namespace, name, selector, port, targetPort }) => {
  const service = {
    apiVersion: 'v1',
    kind: 'Service',
    metadata: { name, namespace },
    spec: {
      selector,
      ports: [{ protocol: 'TCP', port, targetPort }],
    },
  };

  try {
    await coreApi.readNamespacedService(name, namespace);
    return await coreApi.replaceNamespacedService(name, namespace, service);
  } catch (err) {
    if (err.statusCode === 404 || err.response?.statusCode === 404) {
      return await coreApi.createNamespacedService(namespace, service);
    }
    throw unwrapK8sError(err);
  }
};

const upsertIngress = async ({ namespace, name, ingressClassName, rules, annotations = {} }) => {
  const ingress = {
    apiVersion: 'networking.k8s.io/v1',
    kind: 'Ingress',
    metadata: { name, namespace, annotations },
    spec: {
      ingressClassName,
      rules: [
        {
          http: {
            paths: rules.map((rule) => ({
              path: rule.path,
              pathType: rule.pathType || 'Prefix',
              backend: {
                service: {
                  name: rule.serviceName,
                  port: { number: rule.servicePort },
                },
              },
            })),
          },
        },
      ],
    },
  };

  try {
    await networkingApi.readNamespacedIngress(name, namespace);
    return await networkingApi.replaceNamespacedIngress(name, namespace, ingress);
  } catch (err) {
    if (err.statusCode === 404 || err.response?.statusCode === 404) {
      return await networkingApi.createNamespacedIngress(namespace, ingress);
    }
    throw unwrapK8sError(err);
  }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForDeploymentReady = async ({ namespace, name, replicas = 1, timeoutMs = 120000 }) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await appsApi.readNamespacedDeployment(name, namespace);
      const status = response.body.status || {};
      if (
        (status.availableReplicas || 0) >= replicas &&
        (status.observedGeneration || 0) >= (response.body.metadata?.generation || 0)
      ) {
        return response.body;
      }
    } catch (err) {
      throw unwrapK8sError(err);
    }
    await sleep(3000);
  }
  throw new Error(`Deployment "${name}" in namespace "${namespace}" did not become ready within ${timeoutMs}ms`);
};

const deleteDeployment = async ({ namespace, name }) => {
  try {
    await appsApi.readNamespacedDeployment(name, namespace);
    return await appsApi.deleteNamespacedDeployment(name, namespace);
  } catch (err) {
    if (err.statusCode === 404 || err.response?.statusCode === 404) {
      return null; // already gone
    }
    throw unwrapK8sError(err);
  }
};

const deleteService = async ({ namespace, name }) => {
  try {
    await coreApi.readNamespacedService(name, namespace);
    return await coreApi.deleteNamespacedService(name, namespace);
  } catch (err) {
    if (err.statusCode === 404 || err.response?.statusCode === 404) {
      return null;
    }
    throw unwrapK8sError(err);
  }
};

const deleteIngress = async ({ namespace, name }) => {
  try {
    await networkingApi.readNamespacedIngress(name, namespace);
    return await networkingApi.deleteNamespacedIngress(name, namespace);
  } catch (err) {
    if (err.statusCode === 404 || err.response?.statusCode === 404) {
      return null;
    }
    throw unwrapK8sError(err);
  }
};

module.exports = {
  ensureNamespace,
  upsertImagePullSecret,
  upsertDeployment,
  upsertService,
  upsertIngress,
  deleteDeployment,
  deleteService,
  deleteIngress,
  waitForDeploymentReady,
};
