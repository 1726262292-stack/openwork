# daytona-worker-restart-readiness — approved internal proof

1. We start with the worker already healthy through its public Daytona health URL. This proves the sandbox is configured and the official runtime has OpenWork serving before we touch the instance.

2. We stop and start that same Daytona sandbox, then only poll the public health URL. When health returns without any manual relaunch command, the frame proves the worker came back from the container startup path.
