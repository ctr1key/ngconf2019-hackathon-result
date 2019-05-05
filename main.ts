import 'amd-loader';
import { Observable } from 'rxjs';
import { ajax } from 'rxjs/ajax';
import { map} from 'rxjs/operators';
import { Cartesian3, IntersectionTests, BoundingSphere } from 'cesium';

import { XMLHttpRequest}  from 'xmlhttprequest';

const bearerToken: string = '';
const ordersUrl: string = 'https://us-central1-ng-conf-2019-hackathon.cloudfunctions.net/orders';
const submitUrl: string = 'https://us-central1-ng-conf-2019-hackathon.cloudfunctions.net/submit';
const runSubmit: boolean = false;
const orderId: string = 'McnesmdxcmCILD3EOOU4';
const previousDistance: number = 103605.798797653;
const logDebug: boolean = false;
const cullHazardousWormholes: boolean = false;

const submitNow: any[] = null;

function logOrders(order: Order) {
  // Object.keys(order).forEach(key => {
  //   if (order[key].deliveries.length > 40) {
  //     console.log(key + ',' + order[key].deliveries.length);
  //   }
  // });
  // process.exit();
}

interface Order {
  [key: string]: Input;
}
interface Input {
  deliveries: Delivery[];
  wormholes: Wormhole[];
  hazards: Hazard[];

}

interface Delivery {
  name: string;
  x: number;
  y: number;
  z: number;
}

interface Wormhole {
  name: string;
  alphaX: number;
  alphaY: number;
  alphaZ: number;
  omegaX: number;
  omegaY: number;
  omegaZ: number;
}

interface Graph {
  nodes: GraphNode[];
  wormholes: GraphWormhole[];
  hazards: GraphHazard[];
}
interface GraphWormhole {
  name: string;
  alpha: Cartesian3;
  omega: Cartesian3;
}

interface Hazard {
  name: string;
  x: number;
  y: number;
  z: number;
  radius: number;
}

type GraphEdge = DirectEdge | WormholeEdge;
interface DirectEdge {
  readonly kind: 'direct';
  distance: number;
}
interface WormholeEdge {
  readonly kind: 'wh'
  name: string;
  enterAlpha: boolean;
  distance: number;
}

interface GraphHazard {
  name: string;
  sphere: BoundingSphere;
}

function hazardToGraph(hazard: Hazard): GraphHazard {
  return {
    name: hazard.name,
    sphere: new BoundingSphere(new Cartesian3(hazard.x, hazard.y, hazard.z),
      hazard.radius)
  }
}
function whToGraph(wh: Wormhole): GraphWormhole {
  return {
    name: wh.name,
    alpha: new Cartesian3(wh.alphaX, wh.alphaY, wh.alphaZ),
    omega: new Cartesian3(wh.omegaX, wh.omegaY, wh.omegaZ)
  }
}

class GraphNode {
  name: string;
  position: Cartesian3;
  edges: Record<string, GraphEdge>;

  constructor(d: Delivery) {
    this.name = d.name;
    this.position = new Cartesian3(d.x, d.y, d.z);
    this.edges = {};
  }

  public computeShortestEdgeTo(graphNode: GraphNode, wormholes: GraphWormhole[], hazards: GraphHazard[]) {
    // is line segment to GraphNode intersect with hazards
    // if false, compute distance to graph node
    // for each wormhole, check
    // 1.) this to alpha and omega to graphNode
    // 2.) this to omeg and alpha to graphNode
    // if both segments intersect no hazards, sum the 2 distances
    // take the the minimum distance
    let current: GraphEdge = {
      kind: 'direct',
      distance: Number.POSITIVE_INFINITY
    };

    if (hazards.every(hazard => {
      const a = IntersectionTests.lineSegmentSphere(
        this.position, graphNode.position, hazard.sphere
      );
      if (logDebug) {
        console.log(a);
      }
      return !a;
    })) {
        current.distance = Cartesian3.distance(this.position, graphNode.position);
        if (logDebug) {
          console.log(`Distance from ${this.name} to ${graphNode.name} is ${current.distance}`);
        }
    } else {
      if (logDebug) {
        console.log(`Direct route from ${this.name} to ${graphNode.name} is hazardous.`)
      }
    }

    let d1, d2: number | null = null;
    for (let wh of wormholes) {
      // TODO: use more than 1 consecutive wormhole
      if (hazards.every(hazard =>
        !IntersectionTests.lineSegmentSphere(
          this.position, wh.alpha, hazard.sphere
        ))) {
        d1 = Cartesian3.distance(this.position, wh.alpha);
      } else {
        if (logDebug) {
          console.log(`${this.name} to ${wh.name} alpha hits hazard.`);
        }
      }
      if (hazards.every(hazard =>
        !IntersectionTests.lineSegmentSphere(
          graphNode.position, wh.omega, hazard.sphere
        ))) {
        d2 = Cartesian3.distance(graphNode.position, wh.omega);
      }
      if (d1 !== null && d2 !== null) {
        if (logDebug) {
          console.log(`Distance from ${this.name} to ${graphNode.name} using ${wh.name} alpha is ${d1+d2}.`);
        }
        if (d1 + d2  < current.distance) {
        current = {
          kind: 'wh',
          distance: d1 + d2,
          enterAlpha: true,
          name: wh.name
        }
      }
    }
      d1 = null;
      d2 = null;

      // other way
      if (hazards.every(hazard =>
        !IntersectionTests.lineSegmentSphere(
          this.position, wh.omega, hazard.sphere
        ))) {
        d1 = Cartesian3.distance(this.position, wh.omega);
      }
      if (hazards.every(hazard =>
        !IntersectionTests.lineSegmentSphere(
          graphNode.position, wh.alpha, hazard.sphere
        ))) {
        d2 = Cartesian3.distance(graphNode.position, wh.alpha);
      }
      if (d1 !== null && d2 !== null) {
        if (logDebug) {
          console.log(`Distance from ${this.name} to ${graphNode.name} using ${wh.name} omega is ${d1+d2}.`);
        }
        if (d1 + d2  < current.distance) {
        current = {
          kind: 'wh',
          distance: d1 + d2,
          enterAlpha: false,
          name: wh.name
        }
      }
      }
    }

    this.edges[graphNode.name] = current;
    if (current.kind === 'direct') {
      graphNode.edges[this.name] = current;
    } else {
      graphNode.edges[this.name] = {
        kind: 'wh',
        distance: current.distance,
        enterAlpha: !current.enterAlpha,
        name: current.name
      }
    }
  }
}

let ob: Observable<Order>;
ob = ajax({
  createXHR: () => new XMLHttpRequest(),
  url: ordersUrl
}).pipe(map(x => x.response));

import * as solver from 'node-tspsolver';
const originName = '$$$$$$$';
const returnHome: boolean = false;
const ob2 = ob.pipe(
  map<Order, Graph>(order => {
    logOrders(order);
    const input = order[orderId];
    const n = (input.deliveries || []).map(d => new GraphNode(d));
    n.unshift(new GraphNode({name: originName, x: 0, y: 0, z: 0}))
    return {
      nodes:n,
      wormholes: (input.wormholes || []).map(whToGraph),
      hazards: (input.hazards || []).map(hazardToGraph)
    }
  }),
)
if (submitNow !== null) {
  submit(submitNow, orderId);
} else {
ob2.subscribe(graph => {
  if (cullHazardousWormholes) {
    graph.wormholes = graph.wormholes.filter(wh => {
    // if (graph.hazards.some(hazard => !!IntersectionTests.lineSegmentSphere(wh.alpha, wh.omega, hazard.sphere))) {
    //   console.log('Culling hazardous wormhole ' + wh.name);
      return false;
    // }
    // return true;
  });
}
  let l = graph.nodes.length;
  for (let i = 0; i < l - 1; i += 1 ) {
    for (let j = i + 1; j < l; j += 1) {
      graph.nodes[i].computeShortestEdgeTo(graph.nodes[j], graph.wormholes, graph.hazards)
    }
  }
  //console.log(graph);
  console.log('Order Id ' + orderId);
  console.log('Deliveries ' + (graph.nodes.length - 1));
  const costMatrix = createCostMatrix(graph.nodes);
  //console.log('cost matrix');
  //console.log(JSON.stringify(costMatrix));
  let solverOptions: solver.Options | undefined = undefined;
  solverOptions = {
    N: 20000000, // 1000000,
    T: 100, // 100,
    lambda: 0.980, // 0.985
    reheatInterval: null //100000
  };
  runSolver(1, graph, costMatrix, solverOptions);

})
}

function runSolver(attempt: number, graph: Graph, costMatrix: number[][], solverOptions: solver.Options) {
  solver.solveTsp(costMatrix, returnHome, solverOptions).then(
    indices => {
      let total = 0;
      let l = indices.length;
      let result: any[] = [];
      let current, next: GraphNode;
      //console.log(indices);
      current = graph.nodes[0];
      for (let i = 1; i < l; i += 1) {
        next = graph.nodes[indices[i]];
        const e: GraphEdge = current.edges[next.name];
        total += e.distance;
        if (e.kind === 'direct') {
          result.push(next.name);
        } else {
          result.push({wormholeName: e.name, entryPoint: e.enterAlpha ? 'alpha' : 'omega'});
          result.push(next.name);
        }
        current = next;
      }
      console.log('Attempt #: ' + attempt);
      console.log('Order Id: ' + orderId);
      console.log('Total Distance: ' + total);
      console.log(result);
      if (runSubmit) {
        if (total < previousDistance) {
          submit(result, orderId);
        } else {
          runSolver(attempt + 1, graph, costMatrix, solverOptions);
        }
      } else if (total >= previousDistance) {
        runSolver(attempt + 1, graph, costMatrix, solverOptions);
      }
    }
  );
}
function createCostMatrix(graphNodes: GraphNode[]): number[][] {
  const l = graphNodes.length;
  const result = Array(l);
  for (let z = 0; z < l; z+=1) {
    result[z] = new Array(l).fill(Number.POSITIVE_INFINITY);
  }
  
  for (let i = 0; i < l; i += 1) {
    for (let j = 0; j < l; j += 1) {
      if (i === j) {
        result[i][j] = 0;
      } else {
        result[i][j] = graphNodes[i].edges[graphNodes[j].name].distance;
        if (result[i][j] < 0 || result[i][j] === Number.POSITIVE_INFINITY) {
          throw new Error('Invalid distance');
        }
      }
    }
  }
  return result;
}

function submit(data: any[], oId: string) {
  ajax({
    createXHR: () => new XMLHttpRequest(),
    method: 'POST',
    url: submitUrl+'?orderId='+oId,
    headers: {
      "Content-Type": 'application/json',
      Authorization: 'Bearer ' + bearerToken
    },
    body: data,
    responseType: 'text'
  }).subscribe((x) => {
    console.log('submitted');
    console.log(x.response);
    setTimeout(() => console.log('pause period done.'), 60000);
  }, (e)=> console.log(e))
}
