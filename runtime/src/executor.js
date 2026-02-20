import Piscina from "piscina";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { existsSync } from "fs";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
/**
 * Parallel task executor with dependency resolution
 */
export class Executor {
    pool;
    config;
    constructor(config) {
        this.config = config;
        // Resolve worker path: prefer .ts source (tsx/dev), fallback to compiled .js
        const tsWorker = join(__dirname, "worker.ts");
        const jsWorkerDist = join(dirname(__dirname), "dist", "worker.js");
        const jsWorkerSrc = join(__dirname, "worker.js");
        const workerPath = existsSync(tsWorker)
            ? tsWorker
            : existsSync(jsWorkerDist)
                ? jsWorkerDist
                : jsWorkerSrc;
        this.pool = new Piscina({
            filename: workerPath,
            maxThreads: config.maxParallel,
            idleTimeout: 60000,
        });
    }
    /**
     * Execute a plan with intelligent parallel/serial execution
     */
    async execute(plan, tools) {
        const outputs = [];
        // Build dependency graph
        const graph = this.buildDependencyGraph(plan);
        // Execute in batches based on dependencies
        for (const batch of graph.getBatches()) {
            if (batch.length === 1) {
                // Serial execution
                const step = batch[0];
                const output = await this.executeStep(step, tools);
                outputs.push(output);
            }
            else {
                // Parallel execution
                const promises = batch.map((step) => this.executeStep(step, tools));
                const batchOutputs = await Promise.all(promises);
                outputs.push(...batchOutputs);
            }
        }
        return {
            success: true,
            outputs,
        };
    }
    /**
     * Execute a single step
     */
    async executeStep(step, tools) {
        const tool = tools.get(step.toolName);
        if (!tool) {
            throw new Error(`Tool not found: ${step.toolName}`);
        }
        // Prefer in-process execution when tool provides a custom handler
        if (tool.execute) {
            return await tool.execute(step.parameters);
        }
        // Execute in worker thread for isolation
        try {
            const result = await this.pool.run({
                toolName: step.toolName,
                parameters: step.parameters,
            });
            return result;
        }
        catch (error) {
            console.error(`Error executing step ${step.id}:`, error);
            throw error;
        }
    }
    /**
     * Build dependency graph from execution plan
     */
    buildDependencyGraph(plan) {
        const graph = new DependencyGraph();
        for (const step of plan.steps) {
            graph.addNode(step);
            for (const depId of step.dependencies) {
                graph.addEdge(depId, step.id);
            }
        }
        return graph;
    }
    /**
     * Shutdown executor
     */
    async shutdown() {
        await this.pool.destroy();
    }
}
/**
 * Dependency graph for determining execution order
 */
class DependencyGraph {
    nodes = new Map();
    edges = new Map();
    addNode(step) {
        this.nodes.set(step.id, step);
        if (!this.edges.has(step.id)) {
            this.edges.set(step.id, new Set());
        }
    }
    addEdge(from, to) {
        if (!this.edges.has(from)) {
            this.edges.set(from, new Set());
        }
        this.edges.get(from).add(to);
    }
    /**
     * Get batches of independent steps
     */
    getBatches() {
        const batches = [];
        const inDegree = new Map();
        const queue = [];
        // Calculate in-degrees
        for (const [nodeId] of this.nodes) {
            inDegree.set(nodeId, 0);
        }
        for (const [, targets] of this.edges) {
            for (const target of targets) {
                inDegree.set(target, (inDegree.get(target) || 0) + 1);
            }
        }
        // Find nodes with no dependencies
        for (const [nodeId, degree] of inDegree) {
            if (degree === 0) {
                queue.push(nodeId);
            }
        }
        // Process in batches
        while (queue.length > 0) {
            const batch = [];
            // All nodes in queue can run in parallel
            const currentBatch = [...queue];
            queue.length = 0;
            for (const nodeId of currentBatch) {
                const step = this.nodes.get(nodeId);
                if (step) {
                    batch.push(step);
                }
                // Reduce in-degree of dependent nodes
                const targets = this.edges.get(nodeId) || new Set();
                for (const target of targets) {
                    const newDegree = (inDegree.get(target) || 0) - 1;
                    inDegree.set(target, newDegree);
                    if (newDegree === 0) {
                        queue.push(target);
                    }
                }
            }
            if (batch.length > 0) {
                batches.push(batch);
            }
        }
        return batches;
    }
}
//# sourceMappingURL=executor.js.map