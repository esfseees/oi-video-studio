#include <bits/stdc++.h>
using namespace std;

struct Person {
    int t;   // 接水时间
    int id;  // 原来的编号
} a[1005];

bool cmp(Person x, Person y) {
    if (x.t != y.t) return x.t < y.t;  // 时间短的在前
    return x.id < y.id;                // 一样就比编号
}

int main() {
    int n;
    cin >> n;
    for (int i = 1; i <= n; i++) {
        cin >> a[i].t;
        a[i].id = i;
    }
    sort(a + 1, a + n + 1, cmp);

    long long sum = 0;  // 所有人等待时间的总和
    long long s = 0;    // 当前这个人要等多久
    for (int i = 1; i <= n; i++) {
        cout << a[i].id << " ";
        sum += s;       // 先把他的等待时间加进去
        s += a[i].t;    // 后面的人还要多等他这么久
    }
    cout << endl;
    printf("%.2f\n", 1.0 * sum / n);
    return 0;
}
